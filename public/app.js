const sidebarProjectName = document.querySelector('#sidebar-project-name');
const vocabularyLibraryButton = document.querySelector('#vocabulary-library-button');
const searchButton = document.querySelector('#search-button');
const newPageButton = document.querySelector('#new-page-button');
const newFolderButton = document.querySelector('#new-folder-button');
const navigationSortButton = document.querySelector('#navigation-sort-button');
const navigationSortMenu = document.querySelector('#navigation-sort-menu');
const filterButton = document.querySelector('#filter-button');
const descriptorSearchPanel = document.querySelector('#descriptor-search-panel');
const filterPanel = document.querySelector('#filter-panel');
const pageList = document.querySelector('#page-list');
const navigationMoveHint = document.querySelector('#navigation-move-hint');
const leftSidebarToggle = document.querySelector('#left-sidebar-toggle');
const rightSidebarToggle = document.querySelector('#right-sidebar-toggle');
const topTabArea = document.querySelector('#top-tab-area');
const paneToolbarArea = document.querySelector('#pane-toolbar-area');
const workspacePaneRoot = document.querySelector('#workspace-pane-root');
const markdownControlStrip = document.querySelector('#markdown-control-strip');
const markdownModeButton = document.querySelector('#markdown-mode-button');
const markdownModeValue = document.querySelector('#markdown-mode-value');
const markdownStatistics = document.querySelector('#markdown-statistics');
const sharedCountPresentation = globalThis.structuredTextCountModel
  ?.createCountPresentation?.(markdownStatistics) || null;
const markdownZoomOutButton = document.querySelector('#markdown-zoom-out');
const markdownZoomValueButton = document.querySelector('#markdown-zoom-value');
const markdownZoomInButton = document.querySelector('#markdown-zoom-in');
const hnTextControlStrip = document.querySelector('#hn-text-control-strip');
const hnTextModeButton = document.querySelector('#hn-text-mode-button');
const hnTextModeValue = document.querySelector('#hn-text-mode-value');
const hnTextZoomOutButton = document.querySelector('#hn-text-zoom-out');
const hnTextZoomValueButton = document.querySelector('#hn-text-zoom-value');
const hnTextZoomInButton = document.querySelector('#hn-text-zoom-in');
const rightSidebar = document.querySelector('#right-sidebar');
const leftSidebar = document.querySelector('.left-sidebar');
const leftCreateToolbar = document.querySelector('.left-create-toolbar');
const rightChromeSpacer = document.querySelector('.right-chrome-spacer');
const rightSidebarViewButtons = [...document.querySelectorAll('[data-right-sidebar-view]')];
const rightSidebarViewPanels = [...document.querySelectorAll('[data-right-sidebar-view-panel]')];
const maintenanceSection = document.querySelector('#maintenance-section');
const resourcesList = document.querySelector('#resources-list');
const externalLinksList = document.querySelector('#external-links-list');
const externalLinksAddButton = document.querySelector('#external-links-add-button');
const addFileButton = document.querySelector('#add-file-button');
const rightCategoryFilter = document.querySelector('#right-category-filter');
const rightDescriptorFilter = document.querySelector('#right-descriptor-filter');
const rightCategoryClear = document.querySelector('#right-category-clear');
const rightDescriptorClear = document.querySelector('#right-descriptor-clear');
const relationsList = document.querySelector('#relations-list');
const addLinkPopover = document.querySelector('#add-link-popover');
const addLinkTypeLabel = addLinkPopover.querySelector('.add-link-label');
const addLinkTypeSelect = document.querySelector('#add-link-type-select');
const addLinkTypeNa = document.querySelector('#add-link-type-na');
const addLinkNewPageButton = document.querySelector('#add-link-new-page-button');
const addLinkExistingPageButton = document.querySelector('#add-link-existing-page-button');
const addLinkExistingTarget = document.querySelector('#add-link-existing-target');
const addLinkOthersButton = document.querySelector('#add-link-others-button');
const addLinkExternalEditor = document.querySelector('#add-link-external-editor');
const addLinkCancelButton = document.querySelector('#add-link-cancel-button');
const addLinkConfirmButton = document.querySelector('#add-link-confirm-button');
const externalLinkSidebarPopover = document.querySelector('#external-link-sidebar-popover');
const externalLinkSidebarEditor = document.querySelector('#external-link-sidebar-editor');
const externalLinkSidebarCancel = document.querySelector('#external-link-sidebar-cancel');
const externalLinkSidebarConfirm = document.querySelector('#external-link-sidebar-confirm');
const blockLinkChoicePopover = document.querySelector('#block-link-choice-popover');

const MIN_CANVAS_SCALE = 0.1;
const MAX_CANVAS_SCALE = 6;
const CANVAS_FIT_PADDING = 32;
const MIN_BLOCK_SIZE = 8;
const BLOCK_MOVE_THRESHOLD = 3;
const BLOCK_STATE = Object.freeze({
  HIDDEN: 0,
  DEFAULT: 1,
  HIGHLIGHTED: 2,
  ACTIVE: 3
});
const BLOCK_MODE = Object.freeze({
  NORMAL: 'normal',
  BLOCK_EDIT: 'block-edit',
  HIGHLIGHT_VIEW: 'highlight-view',
  HIGHLIGHT_EDIT: 'highlight-edit'
});
const desktopResourceClient = resourceLocationsModel.createDesktopResourceClient({
  getBridge: () => window.cneDesktop,
  getPageId: () => activePaneRuntime()?.currentPage?.id || null
});

let project;
let pageIndex;
let navigation;
let linkTypes;
let categoryConfig;
let descriptorLibrary;
let vocabularyLibrary;
let descriptorGroupsConfig;
const canonicalPages = new Map();
let hnPageDocumentSessionRegistry = null;
const retainedHnSessionReferences = new Map();
let hnSessionReconcileScheduled = false;
const workspace = workspacePanesModel.createWorkspace({
  createSession: () => sessionTabsModel.createTabSession(),
  createViewContext: (paneId) => createPaneViewContext(paneId)
});
const undoManager = undoManagerModel.createUndoManager();
const TAB_TITLE_TOOLTIP_DELAY = 500;
const TAB_REORDER_DRAG_THRESHOLD = 5;
const TAB_REORDER_SETTLE_DURATION = 160;
const TAB_DETACH_RETURN_DURATION = 180;
const TAB_PREVIEW_MORPH_DURATION = 170;
let tabStripResizeObserver = null;
let tabStripLayoutFrame = 0;
let tabTitleTooltipTimer = 0;
let tabTitleTooltipAnchor = null;
let tabTitleTooltipBubble = null;
let tabTitleMeasureContext = null;
let tabReorderState = null;
let tabReorderFrame = 0;
let tabReorderSettleFrame = 0;
let tabReorderSettleTimer = 0;
const tabStripClosingVisuals = new Set();
let tabReorderSuppressedClickId = null;
let tabReorderSuppressedClickTimer = 0;
let sidebarPageDragState = null;
let sidebarPageDragFrame = 0;
let sidebarPageDragSuppressedClickId = null;
let sidebarPageDragSuppressedClickTimer = 0;
const PANE_REORDER_LONG_PRESS_DELAY = 320;
const PANE_REORDER_DRAG_THRESHOLD = 5;
let workspacePaneResizeObserver = null;
let workspacePaneChromeFrame = 0;
let paneDividerDragState = null;
let paneDividerDragFrame = 0;
let paneReorderState = null;
let paneReorderFrame = 0;
let pageContextTarget = null;
let pageContextParentFolderId = null;
let pageContextSynthetic = false;
let pageDeleteInProgress = false;
let folderContextTarget = null;
let folderDeleteInProgress = false;
let relationContextTarget = null;
let relationDeleteInProgress = false;
let folderRenameState = null;
let folderRenameSaveInProgress = false;
let pageRenameState = null;
let pageRenameSaveInProgress = false;
let navigationDragData = null;
let navigationMoveMode = null;
let navigationMoveHoverFolderElement = null;
const selectedNavigationItems = new Set();
let navigationVisibleOrder = [];
let navigationSelectionAnchor = null;
let navigationSelectionAnchorIsImplicitCurrent = false;
let navigationExplicitSelectionMode = false;
let navigationSortMode = navigationSort.DEFAULT_SORT_MODE;
let appearanceSettings = null;
const vaultAppearancePublisher = vaultAppearanceEventsModel.createPublisher({
  onError: (error) => console.warn('[appearance:notification]', error)
});
const vaultAppearancePersistence = vaultAppearanceStoreModel.createHttpAppearancePersistence(request);
const vaultAppearanceStore = vaultAppearanceStoreModel.createVaultAppearanceStore({
  model: appearanceSettingsModel,
  initialAppearance: null,
  persistence: vaultAppearancePersistence,
  notifyCommitted: (_appearance, metadata) => vaultAppearancePublisher.publish({
    generation: metadata.generation
  }),
  logger: console
});
window.addEventListener('pagehide', () => vaultAppearancePublisher.close());
let vaultPreferences = {
  ...pageTypesModel.normalizeSettings(null),
  ...markdownPageModel.normalizeSettings(null),
  ...hnTextModel.normalizeSettings(null)
};
let markdownPreferenceSaveQueue = Promise.resolve();
let pendingMarkdownPreferenceSave = null;
let markdownModePreferenceVersion = 0;
let hnTextModePreferenceVersion = 0;
const markdownBodySaveStates = new Map();
const pageTitleSaveQueues = new Map();
const pendingPageTitleSaves = new Map();
const markdownPageMutationLocks = new Set();
let navigationSortSaveQueue = Promise.resolve();
let filterPanelOpen = false;
let descriptorSearchOpen = false;
let descriptorSearchText = '';
let leftSidebarOpen = true;
let rightSidebarOpen = true;
let leftSidebarExpandedWidth = sidebarResizeModel.DEFAULT_EXPANDED_WIDTH;
let rightSidebarExpandedWidth = sidebarResizeModel.DEFAULT_EXPANDED_WIDTH;
const selectedCategoryFilterIds = new Set();
const collapsedCategoryFilterGroupIds = new Set();
let categoryFilterGroupsInitialized = false;
let resourceContextTarget = null;
let resourceDeleteInProgress = false;
let addFileInProgress = false;
let externalLinkTargetMode = 'url';
let pageMetaModal = null;
let descriptorDraft = null;
let ignoredDescriptorDraft = null;
let ignoredManualEntryIdsDraft = null;
let descriptorDraftDirty = false;
let originalDescriptorGroupsConfig = null;
let descriptorContextTarget = null;
let staleIgnoredDescriptorKeys = null;
const expandedDescriptorGroupIds = new Set();
const selectedDescriptorGroupItems = new Set();
let descriptorGroupVisibleOrder = [];
let descriptorGroupSelectionAnchor = null;
let descriptorGroupRename = null;
let descriptorGroupMoveMode = null;
let descriptorGroupMoveHint = null;
let descriptorGroupMoveHoverNode = null;
let descriptorGroupContextTarget = null;
let descriptorGroupDragSelection = null;
let descriptorBrowserRightWidth = 160;
let descriptorDividerDragCleanup = null;
let dictionaryWindow = null;
const DICTIONARY_DEFAULT_WINDOW_WIDTH = 820;
const DICTIONARY_WINDOW_FEATURES = `width=${DICTIONARY_DEFAULT_WINDOW_WIDTH},height=760,resizable=yes,scrollbars=yes`;
let pendingDictionaryCommand = null;
let dictionarySyncPromise = Promise.resolve();
const handledDictionaryEventIds = new Set();
const dictionaryChannel = typeof BroadcastChannel === 'function'
  ? new BroadcastChannel('cogneuro-dictionary')
  : null;
const descriptorMetadataInstaller = descriptorMetadataInstallModel.createRevisionInstaller({
  apply: applyDescriptorMetadataChangeSet
});
let canvasImageProxyUnsubscribe = null;
const collapsedRelationGroupIds = new Set();
const collapsedRightSectionIds = new Set(['maintenance', 'category', 'descriptor']);
const rightSectionHeights = new Map([
  ['maintenance', 80],
  ['category', 100],
  ['descriptor', 120],
  ['relations', 180],
  ['external-links', 160]
]);
const rightSectionEffectiveHeights = new Map();
const RIGHT_SIDEBAR_VIEW_SECTION_IDS = Object.freeze({
  relations: Object.freeze(['category', 'descriptor', 'relations']),
  resources: Object.freeze(['maintenance', 'external-links'])
});
const RIGHT_SECTION_BODY_MIN_HEIGHT = 64;
let rightSidebarView = 'relations';
const selectedRightCategoryIds = new Set();
const selectedRightDescriptorGroupIds = new Set();
const collapsedRightCategoryGroupIds = new Set();
const expandedRightDescriptorGroupIds = new Set();
let rightCategoryGroupsInitialized = false;
let rightRelationFilterContext = null;
let rightSidebarResizeCleanup = null;
let zoomSensitivity = zoomControls.DEFAULT_ZOOM_SENSITIVITY;

function setRuntimeZoomSensitivity(value) {
  zoomSensitivity = zoomControls.normalizeZoomSensitivity(value);
  return zoomSensitivity;
}

async function loadControlSettings() {
  const bridge = window.cneDesktop;
  if (bridge?.isDesktop !== true || typeof bridge.getControlSettings !== 'function') {
    return setRuntimeZoomSensitivity(zoomControls.DEFAULT_ZOOM_SENSITIVITY);
  }
  try {
    const settings = await bridge.getControlSettings();
    return setRuntimeZoomSensitivity(settings?.zoomSensitivity);
  } catch {
    return setRuntimeZoomSensitivity(zoomControls.DEFAULT_ZOOM_SENSITIVITY);
  }
}

function isGenericPageMutationRequest(url, options, body) {
  const method = String(options?.method || 'GET').toUpperCase();
  const pathname = String(url || '').split(/[?#]/, 1)[0];
  return method === 'POST'
    && /^\/api\/pages\/[^/]+$/.test(pathname)
    && body?.page
    && Object.hasOwn(body, 'metadataChangeSet');
}

function genericPageMutationIsMetadataOnly(options) {
  try {
    const payload = typeof options?.body === 'string'
      ? JSON.parse(options.body)
      : options?.body;
    const metadataFields = new Set([
      'descriptors',
      'ignoredDescriptors',
      'ignoredManualEntryIds',
      'descriptorGroups'
    ]);
    const fields = payload && typeof payload === 'object' ? Object.keys(payload) : [];
    return fields.length > 0 && fields.every((field) => metadataFields.has(field));
  } catch {
    return false;
  }
}

function pageWithInstalledDescriptorMetadata(page, installation) {
  const canonical = page?.id ? canonicalPages.get(page.id) : null;
  if (!canonical) return page;
  const merged = { ...page };
  for (const field of ['descriptors', 'ignoredDescriptors', 'ignoredManualEntryIds']) {
    if (Object.hasOwn(canonical, field)) merged[field] = canonical[field];
  }
  if (markdownPageModel.normalizePageType(canonical.type) === markdownPageModel.PAGE_TYPES.MARKDOWN) {
    merged.markdownBody = canonical.markdownBody || '';
  }
  if (pageIsHnText(canonical)) merged.cneText = canonical.cneText;
  return merged;
}

function metadataInstalledResponse(body, installation) {
  if (!body?.metadataChangeSet) return body;
  const installed = { ...body };
  if (Object.hasOwn(body, 'pageIndex')) installed.pageIndex = pageIndex;
  if (Object.hasOwn(body, 'descriptorRegistry')) installed.descriptorRegistry = descriptorLibrary;
  if (Object.hasOwn(body, 'descriptorLibrary')) installed.descriptorLibrary = descriptorLibrary;
  if (Object.hasOwn(body, 'vocabulary') && vocabularyLibrary) installed.vocabulary = vocabularyLibrary;
  if (Object.hasOwn(body, 'descriptorGroups') && descriptorGroupsConfig) {
    installed.descriptorGroups = descriptorGroupsConfig;
  }
  for (const key of ['page', 'sourcePage', 'targetPage']) {
    if (body[key]?.id) installed[key] = pageWithInstalledDescriptorMetadata(body[key], installation);
  }
  if (Array.isArray(body.pages)) {
    installed.pages = body.pages.map((page) => pageWithInstalledDescriptorMetadata(page, installation));
  }
  if (body.pageEntry?.id) {
    installed.pageEntry = pageIndex.pages.find((page) => page.id === body.pageEntry.id)
      || body.pageEntry;
  }
  return installed;
}

async function revisionGuardedPageIndexResponse(url, options, body) {
  const method = String(options?.method || 'GET').toUpperCase();
  const pathname = String(url || '').split(/[?#]/, 1)[0];
  if (method !== 'GET' || pathname !== '/api/page-index') return body;
  const installedRevision = currentDescriptorMetadataRevision();
  const incomingRevision = body?.metadataRevision;
  if (!Number.isSafeInteger(installedRevision) || !Number.isSafeInteger(incomingRevision)) {
    return body;
  }
  if (incomingRevision < installedRevision) return pageIndex;
  if (incomingRevision === installedRevision) return body;

  const snapshotResponse = await fetch('/api/descriptor-metadata/snapshot');
  const snapshot = await snapshotResponse.json();
  if (!snapshotResponse.ok) {
    const error = new Error(snapshot.error || 'Descriptor metadata snapshot failed.');
    error.status = snapshotResponse.status;
    error.code = snapshot.code || null;
    error.response = snapshot;
    throw error;
  }
  await installDescriptorMetadataChangeSet(snapshot, {
    source: 'page-index-revision-recovery'
  });
  return pageIndex;
}

async function installDescriptorMetadataChangeSet(candidate, context = {}) {
  return descriptorMetadataInstaller.install(candidate, context);
}

function currentDescriptorMetadataRevision() {
  return descriptorMetadataInstaller.currentRevision();
}

function publishDescriptorMetadataChangeSet(responseBody) {
  const metadataChangeSet = responseBody?.metadataChangeSet;
  if (!metadataChangeSet) return;
  const event = {
    type: 'dictionary-data-changed',
    eventId: `main_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    operation: responseBody.operation || 'metadata-commit',
    vocabularyEntryIds: responseBody.vocabularyEntryIds || [],
    descriptorEntryIds: responseBody.descriptorEntryIds || [],
    affectedPageIds: metadataChangeSet.changedPageIds || [],
    descriptorIdRemap: responseBody.descriptorIdRemap || {},
    vocabularyEntryIdRemap: responseBody.vocabularyEntryIdRemap || {},
    metadataChangeSet
  };
  dictionaryChannel?.postMessage(event);
  if (dictionaryWindow && !dictionaryWindow.closed) {
    dictionaryWindow.postMessage(event, window.location.origin);
  }
}

async function request(url, options) {
  const response = await fetch(url, options);
  let body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error || 'Request failed.');
    error.status = response.status;
    error.code = body.code || null;
    error.response = body;
    throw error;
  }
  body = await revisionGuardedPageIndexResponse(url, options, body);
  if (body?.metadataChangeSet) {
    const installation = await installDescriptorMetadataChangeSet(body, {
      source: 'request',
      event: body
    });
    if (installation.applied) publishDescriptorMetadataChangeSet(body);
    body = metadataInstalledResponse(body, installation);
  }
  if (isGenericPageMutationRequest(url, options, body)) {
    return body.metadataChangeSet && genericPageMutationIsMetadataOnly(options)
      ? canonicalPages.get(body.page.id) || body.page
      : body.page;
  }
  return body;
}

function pageApiUrl(pageId, suffix = '') {
  return `/api/pages/${encodeURIComponent(pageId)}${suffix}`;
}

async function saveHnTextRevision({ pageId, baseRevision, cneText }) {
  try {
    return await request(pageApiUrl(pageId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cneText, baseRevision })
    });
  } catch (error) {
    error.pageId = pageId;
    throw error;
  }
}

function updateCanonicalHnTextEnvelope(pageId, cneText) {
  const page = canonicalPages.get(pageId);
  if (!page || !pageIsHnText(page)) return null;
  const next = { ...page, cneText: hnTextModel.cloneJson(cneText) };
  canonicalPages.set(pageId, next);
  for (const runtime of livingPaneRuntimes()) {
    if (runtime.session.activeTab()?.currentPageId === pageId) runtime.currentPage = next;
  }
  const runtime = activePaneRuntime();
  if (runtime?.currentPage?.id === pageId) refreshHnTextControlStrip(runtime);
  return next;
}

function handleHnSessionDocumentChange({ pageId, cneText }) {
  updateCanonicalHnTextEnvelope(pageId, cneText);
}

function handleHnSessionPersisted({ pageId, revision, response }) {
  const savedPage = response?.page || response;
  const latest = canonicalPages.get(pageId);
  if (!latest || !pageIsHnText(latest)) return;
  const settled = {
    ...(savedPage && typeof savedPage === 'object' ? savedPage : latest),
    ...latest,
    updatedAt: savedPage?.updatedAt || latest.updatedAt,
    cneText: { ...latest.cneText, revision }
  };
  canonicalPages.set(pageId, settled);
  if (Array.isArray(pageIndex?.pages)) {
    pageIndex = {
      ...pageIndex,
      pages: pageIndex.pages.map((entry) => entry.id === pageId
        ? {
            ...entry,
            title: settled.title,
            type: settled.type,
            updatedAt: settled.updatedAt || entry.updatedAt
          }
        : entry)
    };
  }
  for (const runtime of livingPaneRuntimes()) {
    if (runtime.session.activeTab()?.currentPageId === pageId) runtime.currentPage = settled;
  }
  globalThis.hnTextPageView?.refreshPageSessionState?.(pageId);
  renderPageList();
  const runtime = activePaneRuntime();
  if (runtime?.currentPage?.id === pageId) refreshHnTextControlStrip(runtime);
}

function handleHnSessionError(error, preferredRuntime = null) {
  const stale = error?.code === 'STALE_CNE_REVISION' || error?.status === 409;
  const pageId = error?.pageId || null;
  if (pageId) globalThis.hnTextPageView?.refreshPageSessionState?.(pageId);
  const preferredMatches = runtimeIsLive(preferredRuntime)
    && (!pageId || (preferredRuntime.currentPage?.id === pageId
      && preferredRuntime.session.activeTab()?.currentPageId === pageId));
  const targets = preferredMatches
    ? [preferredRuntime]
    : (pageId
      ? livingPaneRuntimes().filter((runtime) => (
          runtimeIsLive(runtime)
          && runtime.currentPage?.id === pageId
          && runtime.session.activeTab()?.currentPageId === pageId
        ))
      : []);
  for (const runtime of targets) {
    showRuntimeStatus(
      runtime,
      stale
        ? 'HN Text has a revision conflict. Editing is paused; reload this Page to continue.'
        : error?.message || 'HN Text could not be saved.',
      true,
      stale ? 0 : 4000
    );
  }
}

function hnSessionRegistry() {
  if (!hnPageDocumentSessionRegistry) {
    const model = globalThis.hnPageDocumentSessionModel;
    if (!model?.createHnPageDocumentSessionRegistry) {
      throw new Error('The HN Page document session runtime is unavailable.');
    }
    hnPageDocumentSessionRegistry = model.createHnPageDocumentSessionRegistry({
      save: saveHnTextRevision,
      onDocumentChange: handleHnSessionDocumentChange,
      onPersisted: handleHnSessionPersisted,
      onError: handleHnSessionError
    });
  }
  return hnPageDocumentSessionRegistry;
}

function hnTabReferenceId(paneId, tabId) {
  return `${paneId || 'pane'}:${tabId || 'tab'}`;
}

function trackHnSessionReference(pageId, referenceId) {
  if (!retainedHnSessionReferences.has(pageId)) {
    retainedHnSessionReferences.set(pageId, new Set());
  }
  retainedHnSessionReferences.get(pageId).add(referenceId);
}

function getHnPageDocumentSession(page, runtime, tab) {
  if (!pageIsHnText(page) || !runtimeIsLive(runtime) || !tab) return null;
  const referenceId = hnTabReferenceId(runtime.paneId, tab.id);
  const session = hnSessionRegistry().acquire(page.id, page.cneText, { referenceId });
  const sessionEnvelope = session.currentEnvelope?.();
  if (!hnTextModel.validateCurrentEnvelope(page.cneText).ok
    && hnTextModel.validateCurrentEnvelope(sessionEnvelope).ok) {
    // Supported legacy content migrates in memory at session acquisition. Make
    // that source envelope the app's runtime Page projection immediately; the
    // revisioned Page file is still written only by the normal source-save path.
    updateCanonicalHnTextEnvelope(page.id, sessionEnvelope);
  }
  trackHnSessionReference(page.id, referenceId);
  return session;
}

function desiredHnSessionReferences() {
  const desired = new Map();
  for (const pane of workspace.state.panes) {
    for (const tab of pane.session.tabs()) {
      // A live Tab retains Page-scoped history for its current Page and every
      // Page still reachable through that Tab's Back/Forward history. Orphaned
      // pageViewStates are cached presentation only and are not references.
      const referencedPageIds = new Set([
        tab.currentPageId,
        ...(Array.isArray(tab.history) ? tab.history : [])
      ]);
      for (const pageId of referencedPageIds) {
        if (!pageId) continue;
        const type = canonicalPages.get(pageId)?.type
          || pageIndex?.pages?.find((entry) => entry.id === pageId)?.type;
        if (pageTypesModel.normalizePageType(type) !== pageTypesModel.PAGE_TYPES.HN_TEXT) continue;
        if (!desired.has(pageId)) desired.set(pageId, new Set());
        desired.get(pageId).add(hnTabReferenceId(pane.id, tab.id));
      }
    }
  }
  return desired;
}

async function reconcileHnSessionReferences() {
  hnSessionReconcileScheduled = false;
  if (!hnPageDocumentSessionRegistry) return;
  const desired = desiredHnSessionReferences();

  // A dormant Tab may already refer to a Page whose session was created by a
  // different mounted Tab. Retain every such reference before releasing stale
  // ones so navigating the mounted Tab away cannot transiently dispose the
  // shared Page history. Never create from Page-index metadata: a new session
  // requires a full, validated canonical cneText envelope at mount time.
  for (const [pageId, wanted] of desired) {
    const session = hnPageDocumentSessionRegistry.get(pageId);
    if (!session) continue;
    const retained = retainedHnSessionReferences.get(pageId) || new Set();
    for (const referenceId of wanted) {
      if (retained.has(referenceId)) continue;
      session.retain(referenceId);
      retained.add(referenceId);
    }
    if (retained.size) retainedHnSessionReferences.set(pageId, retained);
  }

  const releases = [];
  for (const [pageId, retained] of retainedHnSessionReferences) {
    const wanted = desired.get(pageId) || new Set();
    for (const referenceId of [...retained]) {
      if (wanted.has(referenceId)) continue;
      retained.delete(referenceId);
      releases.push(hnPageDocumentSessionRegistry.release(pageId, referenceId));
    }
    if (!retained.size) retainedHnSessionReferences.delete(pageId);
  }
  const results = await Promise.allSettled(releases);
  for (const result of results) {
    if (result.status === 'rejected') handleHnSessionError(result.reason);
  }
}

function scheduleHnSessionReferenceReconcile() {
  if (hnSessionReconcileScheduled) return;
  hnSessionReconcileScheduled = true;
  queueMicrotask(() => void reconcileHnSessionReferences());
}

async function flushHnPageDocumentSessionsNow() {
  try {
    globalThis.hnTextPageView?.commitFocusedHnTextEditor?.();
    await hnPageDocumentSessionRegistry?.flushAll?.();
    return { ok: true };
  } catch (error) {
    handleHnSessionError(error);
    return { ok: false, error: error.message || 'HN Text could not be saved.' };
  }
}

globalThis.flushHnPageDocumentSessionsNow = flushHnPageDocumentSessionsNow;

async function lockAndFlushHnPageDocumentSessionForConversion(pageId, runtime = null) {
  const session = hnPageDocumentSessionRegistry?.get?.(pageId) || null;
  if (!session) return { ok: true, session: null };
  try {
    session.setConversionLocked(true);
    await session.flush();
    return { ok: true, session };
  } catch (error) {
    if (!session.disposed) session.setConversionLocked(false);
    handleHnSessionError(error, runtime);
    return { ok: false, session, error };
  }
}

function unlockHnPageDocumentSessionAfterFailedConversion(session) {
  if (!session || session.disposed || !session.saveStatus?.conversionLocked) return false;
  return session.setConversionLocked(false);
}

async function discardHnPageDocumentSessionAfterConversion(pageId) {
  retainedHnSessionReferences.delete(pageId);
  const registry = hnPageDocumentSessionRegistry;
  if (registry?.get?.(pageId)) await registry.discard(pageId, { flush: false });
  scheduleHnSessionReferenceReconcile();
}

function showRuntimeStatus(runtime, message, isError = false, clearAfter = 0) {
  if (!runtimeIsLive(runtime) || !runtime.dom?.statusEl) return false;
  clearTimeout(runtime.statusTimer);
  runtime.statusTimer = null;
  runtime.dom.statusEl.textContent = message;
  runtime.dom.statusEl.classList.toggle('error', isError);

  if (clearAfter) {
    const operation = captureRuntimeOperation(runtime, {
      scope: 'status-clear',
      requireTab: false,
      requirePage: false,
      requirePageLoad: false,
      requireMount: false
    });
    runtime.statusTimer = setTimeout(() => {
      if (!runtimeOperationIsCurrent(operation)) return;
      runtime.statusTimer = null;
      runtime.dom.statusEl.textContent = '';
      runtime.dom.statusEl.classList.remove('error');
    }, clearAfter);
  }
  return true;
}

function itemLabel(item) {
  const location = resourceLocationsModel.tryNormalizeResourceLocation(item);
  const assetPath = item.src || item.path || location?.relativePath;
  if (item.label) return item.label;
  if (item.originalName) return normalizeImportedFilename(item.originalName);
  if (assetPath) return decodeURIComponent(assetPath.split('/').pop());
  return item.code || item.id;
}

function safeDecodeFilename(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function mojibakeMarkerCount(value = '') {
  return (String(value).match(/[ÃÂæçåäéè]/g) || []).length;
}

function cjkCharacterCount(value = '') {
  return (String(value).match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
}

function cleanImportedFilename(name = '') {
  const cleaned = String(name || 'imported-file')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim() || 'imported-file';
  return typeof cleaned.normalize === 'function' ? cleaned.normalize('NFC') : cleaned;
}

function betterImportedFilename(candidate, original) {
  if (!candidate || candidate === original || candidate.includes('\uFFFD')) return false;
  if (cjkCharacterCount(candidate) > cjkCharacterCount(original)) return true;
  return mojibakeMarkerCount(candidate) < mojibakeMarkerCount(original);
}

function latin1ToUtf8String(value) {
  const bytes = Uint8Array.from(
    String(value),
    (char) => char.charCodeAt(0) & 0xff
  );
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function normalizeImportedFilename(name = 'imported-file') {
  let normalized = cleanImportedFilename(name);

  if (/%[0-9a-f]{2}/i.test(normalized)) {
    const decoded = cleanImportedFilename(safeDecodeFilename(normalized));
    if (betterImportedFilename(decoded, normalized)
      || (!decoded.includes('%') && decoded !== normalized)) normalized = decoded;
  }

  if (mojibakeMarkerCount(normalized)) {
    const repaired = cleanImportedFilename(latin1ToUtf8String(normalized));
    if (betterImportedFilename(repaired, normalized)) normalized = repaired;
  }

  return normalized;
}

function cacheBustedSrc(runtime, object) {
  const location = resourceLocationsModel.tryNormalizeResourceLocation(object);
  const src = location && location.type !== 'vault'
    ? pageApiUrl(runtime.currentPage.id, `/resources/${encodeURIComponent(object.id)}/content`)
    : object.src;
  const version = object.updatedAt || object.cacheBuster || object.contentHash;
  if (!src || !version || (location && location.type !== 'vault')) return src;
  const separator = src.includes('?') ? '&' : '?';
  return `${src}${separator}v=${encodeURIComponent(version)}`;
}

function getBlockLinks(block) {
  return (block.links || []).filter((link) => link && typeof link === 'object');
}

function pageLinks(block) {
  return getBlockLinks(block).filter((link) => (
    link.targetType === 'page'
    && typeof link.targetPageId === 'string'
    && link.targetPageId.trim()
  ));
}

function allPageLinks(page) {
  return (page.blocks || []).flatMap((block) => pageLinks(block));
}

function pageBacklinks(page) {
  return (page.backlinks || []).filter((backlink) => (
    backlink.targetType === 'page'
    && typeof backlink.sourcePageId === 'string'
    && typeof backlink.sourceBlockId === 'string'
    && typeof backlink.sourceLinkId === 'string'
  ));
}

function normalizePageTitleForCompare(title) {
  return String(title || '').trim().toLowerCase();
}

function titleFamilyBase(title) {
  return String(title || '').trim().replace(/\s\|\s[1-9]\d*$/, '').trim();
}

function pageTitleExists(title, exceptPageId = null) {
  const normalizedTitle = normalizePageTitleForCompare(title);
  return (pageIndex?.pages || []).some((page) => (
    page.id !== exceptPageId
    && normalizePageTitleForCompare(page.title) === normalizedTitle
  ));
}

function makeUniquePageTitle(baseTitle, exceptPageId = null) {
  const trimmedTitle = String(baseTitle || '').trim();
  if (!pageTitleExists(trimmedTitle, exceptPageId)) return trimmedTitle;

  const familyBase = titleFamilyBase(trimmedTitle) || 'Untitled';
  for (let number = 1; number < 10000; number += 1) {
    const candidate = `${familyBase} | ${number}`;
    if (!pageTitleExists(candidate, exceptPageId)) return candidate;
  }

  return trimmedTitle;
}

function titleDuplicateWarning(title, exceptPageId = null) {
  const trimmedTitle = String(title || '').trim();
  if (!trimmedTitle || !pageTitleExists(trimmedTitle, exceptPageId)) return '';

  const uniqueTitle = makeUniquePageTitle(trimmedTitle, exceptPageId);
  return `"${trimmedTitle}" already exists. It will save as "${uniqueTitle}".`;
}

function updateTitleDuplicateWarning(runtime) {
  if (!runtimeIsLive(runtime) || runtime.dom.titleForm.hidden || !runtime.currentPage
    || runtime.titleSaveInProgress) return;
  const warning = titleDuplicateWarning(runtime.dom.pageTitle.value, runtime.currentPage.id);
  showRuntimeStatus(runtime, warning, Boolean(warning));
}

function defaultLinkTypeId() {
  return linkTypes?.defaultLinkTypeId || linkTypes?.linkTypes?.[0]?.id || 'contains';
}

function renderLinkTypeOptions() {
  addLinkTypeSelect.replaceChildren();
  for (const type of linkTypes?.linkTypes || []) {
    const option = document.createElement('option');
    option.value = type.id;
    option.textContent = type.label || type.id;
    addLinkTypeSelect.append(option);
  }
  addLinkTypeSelect.value = defaultLinkTypeId();
}

function linkTypeConfig(linkTypeId) {
  return (linkTypes?.linkTypes || []).find((type) => type.id === linkTypeId) || null;
}

function relationLinkTypeId(value) {
  return value && linkTypeConfig(value) ? value : 'other';
}

function linkTypeLabel(linkTypeId) {
  if (linkTypeConfig(linkTypeId)?.label) return linkTypeConfig(linkTypeId).label;
  return 'Other';
}

function linkTypeOrder(linkTypeId) {
  const index = (linkTypes?.linkTypes || []).findIndex((type) => type.id === linkTypeId);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function groupedRelationEntries(instances) {
  const groups = new Map();
  for (const instance of instances) {
    const linkTypeId = relationLinkTypeId(instance.displayedLinkTypeId);
    if (!groups.has(linkTypeId)) groups.set(linkTypeId, new Map());
    const pages = groups.get(linkTypeId);
    const pageId = instance.counterpartPageId;
    if (!pages.has(pageId)) pages.set(pageId, []);
    pages.get(pageId).push(instance);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => linkTypeOrder(a) - linkTypeOrder(b) || linkTypeLabel(a).localeCompare(linkTypeLabel(b)))
    .map(([linkTypeId, pages]) => ({
      linkTypeId,
      label: linkTypeLabel(linkTypeId),
      rows: [...pages.entries()].map(([pageId, rowInstances]) => ({ pageId, instances: rowInstances }))
    }));
}

function plural(count, singular, pluralValue = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

function pageDeleteCounts(page) {
  const outgoingPageLinks = allPageLinks(page).length;
  const backlinks = pageBacklinks(page).length;

  return {
    objects: (page.objects || []).length,
    blocks: (page.blocks || []).length,
    relatedLinks: outgoingPageLinks + backlinks
  };
}

function hasDeletableContent(counts) {
  return counts.objects > 0 || counts.blocks > 0 || counts.relatedLinks > 0;
}

function deleteConfirmationMessage(counts) {
  return `Delete this page, ${plural(counts.objects, 'object')}, `
    + `${plural(counts.blocks, 'block')}, and `
    + `${plural(counts.relatedLinks, 'related link')}?`;
}

function blockBelongsToCurrentPage(runtime, block) {
  return Boolean(runtime?.currentPage?.blocks?.some((item) => item.id === block.id));
}

function canOpenAddLinkPopover(runtime, block, anchor) {
  return Boolean(
    runtimeIsLive(runtime)
    && pageCanvasIsVisible(runtime)
    && blockBelongsToCurrentPage(runtime, block)
    && blockIsInteractive(runtime, block)
    && anchor?.isConnected
    && !runtime.blockEditMode
    && !runtime.pageEditMode
    && !runtime.highlightEditDraft
    && !runtime.addLinkInProgress
    && !pageDeleteInProgress
    && runtime.dom.titleForm.hidden
  );
}

function setAddLinkSelection(runtime, selection) {
  if (!runtimeIsLive(runtime)) return false;
  if (selection !== 'external' && typeof clearExternalLinkDropFeedback === 'function') {
    clearExternalLinkDropFeedback();
  }
  runtime.addLinkSelection = selection;
  addLinkNewPageButton.closest('.add-link-row')
    ?.classList.toggle('is-selected', selection === 'new-page');
  addLinkExistingPageButton.closest('.add-link-row')
    ?.classList.toggle('is-selected', selection === 'existing-page');
  addLinkOthersButton.closest('.add-link-row')
    ?.classList.toggle('is-selected', selection === 'external');
  addLinkExistingTarget.hidden = selection !== 'existing-page';
  addLinkExternalEditor.hidden = selection !== 'external';
  addLinkTypeSelect.hidden = selection === 'external';
  addLinkTypeNa.hidden = selection !== 'external';
  if (selection === 'external') addLinkTypeLabel.removeAttribute('for');
  else addLinkTypeLabel.setAttribute('for', 'add-link-type-select');
  if (selection === 'external') {
    mountBlockExternalLinkEditor(runtime);
    addLinkConfirmButton.disabled = !runtime.externalLinkEditorController?.getValidation().valid;
    return;
  }
  if (runtime.externalLinkEditorContext?.kind === 'block') {
    runtime.externalLinkEditorController?.destroy();
    runtime.externalLinkEditorController = null;
    runtime.externalLinkEditorContext = null;
  }
  addLinkConfirmButton.disabled = runtime.addLinkInProgress
    || (selection === 'new-page' ? false : selection !== 'existing-page'
      || !runtime.linkPickMode?.selectedTargetPageId);
  return true;
}

function renderAddLinkExistingTarget(runtime) {
  if (!runtimeIsLive(runtime) || runtime.addLinkSelection !== 'existing-page') {
    addLinkExistingTarget.hidden = true;
    return;
  }

  const targetPage = runtime.linkPickMode?.selectedTargetPageId
    ? pageIndex.pages.find((page) => page.id === runtime.linkPickMode.selectedTargetPageId)
    : null;
  addLinkExistingTarget.hidden = false;
  addLinkExistingTarget.textContent = targetPage
    ? (targetPage.title || targetPage.id)
    : 'No page selected';
  addLinkConfirmButton.disabled = runtime.addLinkInProgress || !targetPage;
}

function exitLinkPickMode(runtime) {
  if (!runtime) return false;
  runtime.linkPickMode = null;
  document.body.classList.remove('link-pick-mode');
  renderAddLinkExistingTarget(runtime);
  if (pageIndex) renderPageList();
  return true;
}

function enterLinkPickMode(runtime) {
  if (!runtimeIsLive(runtime) || !runtime.currentPage || !runtime.addLinkTarget?.blockId) return;
  runtime.linkPickMode = {
    active: true,
    sourceBlockId: runtime.addLinkTarget.blockId,
    sourcePageId: runtime.currentPage.id,
    selectedTargetPageId: null
  };
  document.body.classList.add('link-pick-mode');
  setAddLinkSelection(runtime, 'existing-page');
  renderAddLinkExistingTarget(runtime);
  setLeftSidebarOpen(true);
  descriptorSearchOpen = true;
  renderDescriptorSearchPanel({ focus: true, selectAll: true });
  renderPageList();
}

function selectLinkTargetPage(runtime, page) {
  if (!runtimeIsLive(runtime) || !runtime.linkPickMode || !page) return;
  runtime.linkPickMode.selectedTargetPageId = page.id;
  renderAddLinkExistingTarget(runtime);
  showRuntimeStatus(runtime, `Selected ${page.title || page.id}`, false, 1200);
}

function focusEmptyTabPageSearch(runtime) {
  const tab = activeTab(runtime);
  if (!tab || tab.currentPageId !== null) return false;
  closeAddLinkPopover(runtime);
  setLeftSidebarOpen(true);
  descriptorSearchOpen = true;
  renderDescriptorSearchPanel({ focus: true });
  return true;
}

async function populateActiveEmptyTab(runtime, pageId) {
  const tab = activeTab(runtime);
  if (!tab || tab.currentPageId !== null) return false;
  return navigateCurrentTabToPage(runtime, pageId, {
    preferCanonical: true,
    saveCurrentView: false,
    unavailableMessage: null
  });
}

function closeAddLinkPopover(runtime, {
  sharedPresentation = runtime === activePaneRuntime()
} = {}) {
  if (!runtime) return false;
  if (sharedPresentation && typeof clearExternalLinkDropFeedback === 'function') {
    clearExternalLinkDropFeedback();
  }
  if (runtime.addLinkTarget?.blockId) {
    const overlay = blockOverlay(runtime, runtime.addLinkTarget.blockId);
    if (overlay) setBlockState(runtime, overlay, 'add-link', null);
  }

  if (sharedPresentation) {
    addLinkPopover.hidden = true;
    addLinkPopover.style.left = '';
    addLinkPopover.style.top = '';
  }
  runtime.addLinkTarget = null;
  if (sharedPresentation) exitLinkPickMode(runtime);
  else runtime.linkPickMode = null;
  if (runtime.externalLinkEditorContext?.kind === 'block') {
    runtime.externalLinkEditorController?.destroy();
    runtime.externalLinkEditorController = null;
    runtime.externalLinkEditorContext = null;
  }
  if (sharedPresentation) {
    if (!runtime.addLinkInProgress) addLinkNewPageButton.disabled = false;
    setAddLinkSelection(runtime, null);
  } else {
    runtime.addLinkSelection = null;
  }
  return true;
}

function categoryRoots() {
  if (Array.isArray(categoryConfig?.groups)) return categoryConfig.groups;
  if (Array.isArray(categoryConfig?.categories)) {
    return [{
      id: 'categories',
      label: 'Categories',
      children: categoryConfig.categories.map((category) => ({
        type: 'item',
        id: category.id,
        label: category.label
      }))
    }];
  }
  return [];
}

function initializeCategoryFilterGroupsCollapsed() {
  if (categoryFilterGroupsInitialized) return;
  for (const root of categoryRoots()) {
    const groupId = root.id || root.label || 'category-group';
    collapsedCategoryFilterGroupIds.add(groupId);
  }
  categoryFilterGroupsInitialized = true;
}

function categoryFilterGroupMap() {
  const map = new Map();
  const visit = (node, groupId) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'item' && typeof node.id === 'string') {
      map.set(node.id, groupId || node.id);
      return;
    }
    const nextGroupId = groupId || node.id || node.label || 'categories';
    for (const child of node.children || []) visit(child, nextGroupId);
  };

  for (const root of categoryRoots()) visit(root, root.id || root.label || 'categories');
  return map;
}

function activeCategoryFilterGroups() {
  const itemToGroup = categoryFilterGroupMap();
  const groups = new Map();
  for (const categoryId of selectedCategoryFilterIds) {
    const groupId = itemToGroup.get(categoryId) || categoryId;
    if (!groups.has(groupId)) groups.set(groupId, new Set());
    groups.get(groupId).add(categoryId);
  }
  return groups;
}

function categoryFilterActive() {
  return selectedCategoryFilterIds.size > 0;
}

function pageMatchesCategoryFilter(page) {
  if (!categoryFilterActive()) return true;
  const pageCategorySet = new Set(pageCategories(page));
  if (!pageCategorySet.size) return false;

  for (const selectedIds of activeCategoryFilterGroups().values()) {
    let groupMatched = false;
    for (const categoryId of selectedIds) {
      if (pageCategorySet.has(categoryId)) {
        groupMatched = true;
        break;
      }
    }
    if (!groupMatched) return false;
  }

  return true;
}

function descriptorSearchQuery() {
  return String(descriptorSearchText || '').trim();
}

function descriptorSearchActive() {
  return descriptorSearchQuery().length > 0;
}

function exactDescriptorSearchVocabularyIds(query) {
  const ids = new Set();
  for (const entry of vocabularyLibrary?.entries || []) {
    if (String(entry.display || '').trim() === query) ids.add(entry.id);
    for (const alias of entry.aliases || []) {
      if (String(alias || '').trim() === query) ids.add(entry.id);
    }
  }
  return ids;
}

function descriptorEntryIdsForSearchQuery(query = descriptorSearchQuery()) {
  const trimmedQuery = String(query || '').trim();
  if (!trimmedQuery) return null;

  const vocabularyIds = exactDescriptorSearchVocabularyIds(trimmedQuery);
  const descriptorIds = new Set();
  if (vocabularyIds.size) {
    for (const entry of descriptorLibrary?.entries || []) {
      if (entry.vocabularyEntryId && vocabularyIds.has(entry.vocabularyEntryId)) {
        descriptorIds.add(entry.id);
      }
    }
    return descriptorIds;
  }

  for (const entry of descriptorLibrary?.entries || []) {
    if (String(entry.display || '').trim() === trimmedQuery) {
      descriptorIds.add(entry.id);
    }
  }
  return descriptorIds;
}

function pageDescriptorIds(page) {
  const ids = new Set();
  for (const descriptorId of Array.isArray(page.descriptorIds) ? page.descriptorIds : []) {
    if (typeof descriptorId === 'string') ids.add(descriptorId);
  }

  if (page.descriptors && typeof page.descriptors === 'object' && !Array.isArray(page.descriptors)) {
    for (const classIds of Object.values(page.descriptors)) {
      for (const descriptorId of Array.isArray(classIds) ? classIds : []) {
        if (typeof descriptorId === 'string') ids.add(descriptorId);
      }
    }
  }

  return ids;
}

function pageMatchesDescriptorSearch(page, matchedDescriptorIds = descriptorEntryIdsForSearchQuery()) {
  if (!descriptorSearchActive()) return true;
  if (!matchedDescriptorIds?.size) return false;
  const pageIds = pageDescriptorIds(page);
  for (const descriptorId of matchedDescriptorIds) {
    if (pageIds.has(descriptorId)) return true;
  }
  return false;
}

function pageMatchesNavigationView(page) {
  if (activePaneRuntime().linkPickMode && activePaneRuntime().currentPage?.id === page.id) return false;
  return pageMatchesCategoryFilter(page) && pageMatchesDescriptorSearch(page);
}

function navigationViewRestricted() {
  return Boolean(activePaneRuntime().linkPickMode) || categoryFilterActive() || descriptorSearchActive();
}

function setSidebarCollapsed(side, collapsed) {
  if (side !== 'left' && side !== 'right') return false;

  const isRight = side === 'right';
  const open = !Boolean(collapsed);
  if (isRight) rightSidebarOpen = open;
  else leftSidebarOpen = open;

  if (!open && isRight && typeof clearExternalLinkBlockHover === 'function') {
    const runtime = activePaneRuntime();
    if (runtime) clearExternalLinkBlockHover(runtime);
  }
  if (!open && !isRight && typeof clearNavigationSelection === 'function') {
    clearNavigationSelection();
    if (typeof closeNavigationMoveMenu === 'function') closeNavigationMoveMenu();
    if (typeof closeNavigationSortMenu === 'function') closeNavigationSortMenu();
  }

  const toggle = isRight ? rightSidebarToggle : leftSidebarToggle;
  const interactionRoots = isRight
    ? [rightSidebar, rightChromeSpacer]
    : [leftSidebar, leftCreateToolbar];
  document.body.classList.toggle(`${side}-sidebar-collapsed`, !open);
  toggle?.classList.toggle('is-active', open);
  toggle?.setAttribute('aria-pressed', String(open));
  for (const root of interactionRoots) {
    if (root) root.inert = !open;
  }

  if (open && typeof restoreSidebarExpandedWidth === 'function') {
    restoreSidebarExpandedWidth(side);
    const otherSide = isRight ? 'left' : 'right';
    const otherOpen = isRight ? leftSidebarOpen : rightSidebarOpen;
    if (otherOpen) restoreSidebarExpandedWidth(otherSide);
  }
  if (isRight && open) requestAnimationFrame(updateRightSidebarLayout);
  if (typeof scheduleWorkspaceStateSave === 'function') scheduleWorkspaceStateSave();
  return open;
}

function setLeftSidebarOpen(open) {
  return setSidebarCollapsed('left', !Boolean(open));
}

function toggleLeftSidebar() {
  setLeftSidebarOpen(!leftSidebarOpen);
}

function setRightSidebarOpen(open) {
  return setSidebarCollapsed('right', !Boolean(open));
}

function toggleRightSidebar() {
  setRightSidebarOpen(!rightSidebarOpen);
}

function renderDescriptorSearchPanel({ focus = false, selectAll = false } = {}) {
  descriptorSearchPanel.replaceChildren();
  descriptorSearchPanel.hidden = !descriptorSearchOpen;
  searchButton?.classList.toggle('active', descriptorSearchActive());
  searchButton?.setAttribute('aria-expanded', String(descriptorSearchOpen));

  if (!descriptorSearchOpen) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'descriptor-search-box';

  const icon = createViewerChromeIcon('search', 'descriptor-search-icon');

  const input = document.createElement('input');
  input.className = 'descriptor-search-input';
  input.type = 'search';
  input.value = descriptorSearchText;
  input.placeholder = 'Search descriptors';
  input.setAttribute('aria-label', 'Search descriptors');
  input.addEventListener('input', () => {
    descriptorSearchText = input.value;
    searchButton?.classList.toggle('active', descriptorSearchActive());
    clearButton.disabled = !descriptorSearchText;
    renderPageList();
    scheduleWorkspaceStateSave();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
    const runtime = activePaneRuntime();
    if (!runtime || activeTab(runtime)?.currentPageId !== null) return;
    event.preventDefault();
    input.blur();
    runtime.dom.emptyTabGoToPageButton?.focus();
  });

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'descriptor-search-clear';
  clearButton.textContent = '×';
  clearButton.setAttribute('aria-label', 'Clear descriptor search');
  clearButton.disabled = !descriptorSearchText;
  clearButton.addEventListener('click', () => {
    descriptorSearchText = '';
    renderDescriptorSearchPanel({ focus: true });
    renderPageList();
    scheduleWorkspaceStateSave();
  });

  wrapper.append(icon, input, clearButton);
  descriptorSearchPanel.append(wrapper);

  if (focus) {
    queueMicrotask(() => {
      input.focus();
      if (selectAll && input.value) input.select();
      else input.setSelectionRange(input.value.length, input.value.length);
    });
  }
}

function updateBatchCategoryBox(box, categoryId, instructions) {
  const state = instructions.get(categoryId) || 'neutral';
  box.dataset.categoryInstruction = state;
  box.textContent = state === 'add' ? '+' : state === 'remove' ? '−' : '';
  box.setAttribute('aria-label', `${state === 'neutral' ? 'No change for' : state === 'add' ? 'Add' : 'Remove'} category ${categoryId}`);
}

function renderCategoryNode(node, selectedIds, depth = 0, options = {}) {
  if (!node || typeof node !== 'object') return null;

  if (node.type === 'item') {
    const label = document.createElement(options.batch ? 'div' : 'label');
    label.className = `category-checkbox${options.batch ? ' category-batch-instruction' : ''}`;
    label.style.setProperty('--category-depth', String(depth));

    let checkbox;
    if (options.batch) {
      checkbox = document.createElement('button');
      checkbox.type = 'button';
      checkbox.className = 'category-batch-state-box';
      checkbox.dataset.categoryId = node.id;
      updateBatchCategoryBox(checkbox, node.id, options.instructions);
      checkbox.addEventListener('click', () => {
        const current = options.instructions.get(node.id) || 'neutral';
        const next = categoryBatch.nextInstructionState(current);
        if (next === 'neutral') options.instructions.delete(node.id);
        else options.instructions.set(node.id, next);
        updateBatchCategoryBox(checkbox, node.id, options.instructions);
      });
    } else {
      checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = node.id;
      checkbox.checked = selectedIds.has(node.id);
    }

    const text = document.createElement('span');
    text.textContent = node.label || node.id;

    label.append(checkbox, text);
    return label;
  }

  const group = document.createElement('section');
  group.className = depth === 0 ? 'category-group' : 'category-nested-group';

  if (node.label || node.id) {
    const heading = document.createElement(depth === 0 ? 'h3' : 'h4');
    heading.textContent = node.label || node.id;
    group.append(heading);
  }

  const children = document.createElement('div');
  children.className = 'category-children';
  for (const child of node.children || []) {
    const childElement = renderCategoryNode(child, selectedIds, depth + 1, options);
    if (childElement) children.append(childElement);
  }
  group.append(children);
  return group;
}

function renderCategoryEditor(runtime, options = {}) {
  const selectedIds = options.batch
    ? new Set()
    : new Set(Array.isArray(runtime?.currentPage?.categories) ? runtime.currentPage.categories : []);
  const container = document.createElement('div');
  container.className = 'category-editor';

  const roots = categoryRoots();
  if (!roots.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No categories configured.';
    container.append(empty);
    return container;
  }

  for (const group of roots) {
    const groupElement = renderCategoryNode(group, selectedIds, 0, options);
    if (groupElement) container.append(groupElement);
  }

  return container;
}

function renderFilterPanel() {
  initializeCategoryFilterGroupsCollapsed();
  filterPanel.replaceChildren();
  filterPanel.hidden = !filterPanelOpen;
  filterButton?.classList.toggle('active', categoryFilterActive());
  filterButton?.setAttribute('aria-expanded', String(filterPanelOpen));

  if (!filterPanelOpen) return;

  const header = document.createElement('div');
  header.className = 'filter-panel-header';

  const title = document.createElement('h3');
  title.textContent = 'Category Filter';

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'filter-clear-button ui-outline-action';
  clearButton.textContent = 'Clear';
  clearButton.disabled = !categoryFilterActive();
  clearButton.addEventListener('click', () => {
    selectedCategoryFilterIds.clear();
    renderFilterPanel();
    renderPageList();
    scheduleWorkspaceStateSave();
  });

  header.append(title, clearButton);
  filterPanel.append(header);

  const roots = categoryRoots();
  if (!roots.length) {
    const empty = document.createElement('p');
    empty.className = 'nav-folder-empty';
    empty.textContent = 'No categories configured.';
    filterPanel.append(empty);
    return;
  }

  const body = document.createElement('div');
  body.className = 'filter-panel-body';
  for (const root of roots) {
    const groupElement = renderFilterGroup(root);
    if (groupElement) body.append(groupElement);
  }
  filterPanel.append(body);
}

function renderFilterGroup(group) {
  if (!group || typeof group !== 'object') return null;
  const groupId = group.id || group.label || 'category-group';
  const collapsed = collapsedCategoryFilterGroupIds.has(groupId);

  const section = document.createElement('section');
  section.className = 'filter-group';
  section.dataset.collapsed = String(collapsed);

  const headingButton = document.createElement('button');
  headingButton.type = 'button';
  headingButton.className = 'filter-group-heading';
  headingButton.setAttribute('aria-expanded', String(!collapsed));

  const indicator = document.createElement('span');
  indicator.className = 'filter-group-indicator disclosure-chevron';
  indicator.setAttribute('aria-hidden', 'true');

  const headingText = document.createElement('span');
  headingText.textContent = group.label || group.id || 'Category';

  headingButton.append(indicator, headingText);
  headingButton.addEventListener('click', () => {
    if (collapsedCategoryFilterGroupIds.has(groupId)) {
      collapsedCategoryFilterGroupIds.delete(groupId);
    } else {
      collapsedCategoryFilterGroupIds.add(groupId);
    }
    renderFilterPanel();
    scheduleWorkspaceStateSave();
  });
  section.append(headingButton);

  const items = document.createElement('div');
  items.className = 'filter-group-items';
  items.hidden = collapsed;

  const addItems = (nodes = [], depth = 0) => {
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      if (node.type === 'item') {
        const checkboxControl = filterCheckboxControl.create({
          document,
          checked: selectedCategoryFilterIds.has(node.id),
          value: node.id,
          text: node.label || node.id,
          onChange: (event) => {
            if (event.currentTarget.checked) selectedCategoryFilterIds.add(node.id);
            else selectedCategoryFilterIds.delete(node.id);
            renderFilterPanel();
            renderPageList();
            scheduleWorkspaceStateSave();
          }
        });
        const label = checkboxControl.element;
        label.style.setProperty('--filter-depth', String(depth));
        items.append(label);
      } else {
        addItems(node.children || [], depth + 1);
      }
    }
  };

  addItems(group.children || []);
  section.append(items);
  return section;
}

function selectedCategoryIdsFromModal() {
  return [...pageMetaModal.modal.querySelectorAll('.category-checkbox input:checked')]
    .map((input) => input.value);
}


function positionAddLinkPopover(runtime, anchor) {
  if (runtime !== activePaneRuntime() || !anchor?.isConnected) return false;
  const rect = anchor.getBoundingClientRect();
  addLinkPopover.hidden = false;
  const width = addLinkPopover.offsetWidth || 240;
  const height = addLinkPopover.offsetHeight || 220;
  const left = Math.min(rect.right + 8, window.innerWidth - width - 8);
  const top = Math.min(rect.top, window.innerHeight - height - 8);
  addLinkPopover.style.left = `${Math.max(8, left)}px`;
  addLinkPopover.style.top = `${Math.max(8, top)}px`;
  return true;
}

function openAddLinkPopover(runtime, block, anchor) {
  if (runtime !== activePaneRuntime() || !canOpenAddLinkPopover(runtime, block, anchor)) return;

  closeAddLinkPopover(runtime);
  closeSidebarExternalLinkEditor(runtime);
  closeBlockLinkChoicePopover();
  closePageContextMenu();
  closeResourceContextMenu();
  setEditMenuOpen(runtime, false);
  setHighlightMenuOpen(runtime, false);
  renderLinkTypeOptions();
  runtime.addLinkTarget = { blockId: block.id };
  setBlockState(runtime, anchor, 'add-link', BLOCK_STATE.ACTIVE);
  setAddLinkSelection(runtime, null);
  positionAddLinkPopover(runtime, anchor);
}

function openMultiLinkMenu(runtime, block, anchor) {
  closeAddLinkPopover(runtime);
  openBlockLinkChoice(runtime, block, anchor || blockOverlay(runtime, block.id));
}

function handleBlockClick(runtime, event, block) {
  if (!runtimeIsLive(runtime) || !blockIsInteractive(runtime, block)
    || runtime.blockEditMode || runtime.pageEditMode || runtime.highlightEditDraft) return;

  const targets = clickableBlockTargets(runtime, block);
  if (targets.length === 0) {
    openAddLinkPopover(runtime, block, event.currentTarget);
    return;
  }

  closeAddLinkPopover(runtime);

  if (targets.length === 1) {
    const [target] = targets;
    if (target.kind === 'page') navigateCurrentTabToPage(runtime, target.link.targetPageId);
    else if (target.kind === 'external') openExternalLinkTarget(runtime, target.link);
    else showRuntimeStatus(runtime, 'This block link type is not available yet.', false, 2400);
    return;
  }

  openMultiLinkMenu(runtime, block, event.currentTarget);
}

function deleteDraftBlock(runtime, blockId) {
  if (!runtimeIsLive(runtime) || !runtime.blockEditMode || runtime.blockSaveInProgress) return false;
  const block = runtime.draftBlocks.find((item) => item.id === blockId);
  if (!block) return false;
  const linkCount = (block.links || []).length;
  if (linkCount > 0) {
    const linkWord = linkCount === 1 ? 'link' : 'links';
    const confirmed = window.confirm(
      `Delete this block and its ${linkCount} ${linkWord}?`
    );
    if (!confirmed) return false;
  }
  if (runtime.blockTransform?.blockId === blockId) {
    if (runtime.dom.canvasArea.hasPointerCapture(runtime.blockTransform.pointerId)) {
      runtime.dom.canvasArea.releasePointerCapture(runtime.blockTransform.pointerId);
    }
    runtime.blockTransform = null;
  }
  const beforeBlocks = cloneBlocks(runtime.draftBlocks);
  runtime.draftBlocks = runtime.draftBlocks.filter((item) => item.id !== blockId);
  if (runtime.selectedBlockId === blockId) runtime.selectedBlockId = null;
  renderBlockOverlays(runtime, runtime.draftBlocks);
  renderRelations(runtime, { ...runtime.currentPage, blocks: runtime.draftBlocks });
  recordDraftBlockChange(runtime, beforeBlocks, runtime.draftBlocks, {
    undoSelection: blockId,
    redoSelection: null
  });
  return true;
}

async function handleBlockContextMenu(runtime, event, blockId) {
  if (!runtimeIsLive(runtime)) return;
  if (runtime.blockEditMode) {
    event.preventDefault();
    event.stopPropagation();
    if (runtime.blockSaveInProgress) return;
    const block = runtime.draftBlocks.find((item) => item.id === blockId);
    if (!block) return;
    setSelectedBlock(runtime, blockId);
    if (!window.nativeContextMenu?.available()) return;
    const operation = captureRuntimeOperation(runtime, { scope: 'block-context-menu', blockId });
    const objectBlocks = runtime.draftBlocks.filter((item) => item.objectId === block.objectId);
    const index = objectBlocks.findIndex((item) => item.id === blockId);
    const command = await window.nativeContextMenu.open(event, {
      type: 'block-edit',
      targetId: blockId,
      canBringForward: index >= 0 && index < objectBlocks.length - 1,
      canBringToFront: index >= 0 && index < objectBlocks.length - 1,
      canSendBackward: index > 0,
      canSendToBack: index > 0
    });
    if (!runtimeOperationIsCurrent(operation) || !runtime.blockEditMode
      || !runtime.draftBlocks.some((item) => item.id === blockId)) return;
    if (command === 'delete-block') deleteDraftBlock(runtime, blockId);
    else applyBlockLayerCommand(runtime, blockId, command);
    return;
  }

  if (!window.nativeContextMenu?.available()) return;
  const anchor = event.currentTarget || blockOverlay(runtime, blockId);
  const block = runtime.currentPage?.blocks?.find((item) => item.id === blockId);
  if (!block || !blockIsInteractive(runtime, block)) return;
  const operation = captureRuntimeOperation(runtime, { scope: 'block-context-menu', blockId });
  const command = await window.nativeContextMenu.open(event, {
    type: 'block',
    targetId: blockId
  });
  if (command !== 'add-block-link' || !runtimeOperationIsCurrent(operation)) return;
  const freshBlock = runtime.currentPage?.blocks?.find((item) => item.id === blockId);
  if (!freshBlock) return;
  openAddLinkPopover(
    runtime,
    freshBlock,
    anchor?.isConnected ? anchor : blockOverlay(runtime, blockId)
  );
}

function pageHasBlockEditTarget(page) {
  return (page?.objects || [])
    .some((object) => isDisplayableObject(object) && isVisibleObject(object));
}

function pageIsSupported(page) {
  return Boolean(page?.id && pageTypesModel.pageTypeIsRegistered(page.type));
}

function pageSupportsCapability(page, capability) {
  return Boolean(page?.id && pageTypesModel.pageTypeSupports(page.type, capability));
}

function pageSupportsCanvas(page) {
  return pageSupportsCapability(page, 'canvas');
}

function pageSupportsFileImport(page) {
  return pageSupportsCapability(page, 'file-import');
}

function pageIsHnText(page) {
  return Boolean(page?.id
    && pageTypesModel.normalizePageType(page.type) === pageTypesModel.PAGE_TYPES.HN_TEXT);
}

function hnTextSourceFromEnvelope(value) {
  if (typeof value?.source === 'string'
    && hnTextModel.validateCurrentEnvelope?.(value)?.ok) {
    return value.source;
  }
  const migration = hnTextModel.migratePersistedEnvelope?.(value);
  return migration?.ok && typeof migration.envelope?.source === 'string'
    ? migration.envelope.source
    : '';
}

function setPaneInfoPanelsAvailable(runtime, page) {
  if (!runtimeIsLive(runtime)) return;
  if (pageSupportsCanvas(page)) {
    if (typeof renderInfoPanelsForRuntime === 'function') renderInfoPanelsForRuntime(runtime);
    return;
  }
  const pane = getWorkspacePane(runtime.paneId);
  const layer = runtime.dom?.infoPanelLayer
    || runtime.dom?.canvasArea?.querySelector?.(':scope > .info-panel-layer')
    || pane?.element?.querySelector?.('.info-panel-layer');
  if (!layer) return;
  layer.replaceChildren();
  layer.hidden = true;
}

function updateEditAvailability(runtime) {
  if (!runtimeIsLive(runtime)) return;
  const hasPage = pageIsSupported(runtime.currentPage);
  const supportsCanvas = hasPage
    && pageTypesModel.pageTypeSupports(runtime.currentPage.type, 'canvas');
  const supportsPageEdit = hasPage
    && pageTypesModel.pageTypeSupports(runtime.currentPage.type, 'page-edit');
  const pageEditType = pageTypesModel.normalizePageType(runtime.currentPage?.type);
  const hasPageEditImplementation = pageEditType === pageTypesModel.PAGE_TYPES.CANVAS
    || pageEditType === pageTypesModel.PAGE_TYPES.MARKDOWN
    || pageEditType === pageTypesModel.PAGE_TYPES.HN_TEXT;
  const canEditBlocks = supportsCanvas && pageHasBlockEditTarget(runtime.currentPage);
  const visibleObjectCount = supportsCanvas
    ? (runtime.currentPage.objects || [])
      .filter((object) => isDisplayableObject(object) && isVisibleObject(object)).length
    : 0;
  runtime.dom.editBlockButton.disabled = !hasPage;
  runtime.dom.editBlockMenuItem.disabled = !canEditBlocks;
  runtime.dom.editPageMenuItem.disabled = !supportsPageEdit || !hasPageEditImplementation || (
    pageEditType === pageTypesModel.PAGE_TYPES.CANVAS
    && visibleObjectCount < 2
  );
  runtime.dom.pageCategoryMenuItem.disabled = !hasPage;
  runtime.dom.pageDescriptorMenuItem.disabled = !hasPage;
  runtime.dom.highlightButton.disabled = !supportsCanvas || runtime.pageEditSaveInProgress;
  updatePaneToolbarPresentation(getWorkspacePane(runtime.paneId));
}

function syncMarkdownDraftToOtherPanes(pageId, ownerRuntime) {
  const page = canonicalPages.get(pageId);
  if (!page) return;
  for (const runtime of livingPaneRuntimes()) {
    if (runtime === ownerRuntime || runtime.session.activeTab()?.currentPageId !== pageId) continue;
    runtime.currentPage = page;
    const updated = updateStructuredTextPageLayerForRuntime(runtime, page);
    if (!updated) renderPageContent(runtime, page, { fit: false });
    setPaneInfoPanelsAvailable(runtime, page);
    updatePaneToolbarPresentation(getWorkspacePane(runtime.paneId));
    if (runtime === activePaneRuntime()) refreshActivePaneWindowChrome(runtime);
  }
}

function persistMarkdownBody(pageId) {
  const state = markdownBodySaveStates.get(pageId);
  const page = canonicalPages.get(pageId);
  if (!state || !page) return Promise.resolve();
  if (state.saving) return state.inFlight || Promise.resolve();
  const body = page.markdownBody || '';
  if (body === state.savedBody) return Promise.resolve();
  state.saving = true;
  state.pendingBody = body;
  const operation = (async () => {
    try {
      const saved = await request(pageApiUrl(pageId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdownBody: body })
      });
      state.savedBody = saved.markdownBody || '';
      const latest = canonicalPages.get(pageId);
      const latestBody = latest?.markdownBody || '';
      // This endpoint mutates only markdownBody. Preserve any newer canonical
      // fields (for example a title saved while this request was in flight).
      const canonical = latest
        ? {
            ...saved,
            ...latest,
            markdownBody: latestBody === body ? (saved.markdownBody || '') : latestBody
          }
        : saved;
      canonicalPages.set(pageId, canonical);
      for (const runtime of livingPaneRuntimes()) {
        if (runtime.session.activeTab()?.currentPageId === pageId) runtime.currentPage = canonical;
      }
      const activeRuntime = activePaneRuntime();
      if (activeRuntime?.currentPage?.id === pageId) activeRuntime.currentPage = canonical;
    } catch (error) {
      const activeRuntime = activePaneRuntime();
      if (activeRuntime?.currentPage?.id === pageId) {
        showRuntimeStatus(activeRuntime, error.message || 'Markdown text could not be saved.', true);
      }
    } finally {
      state.saving = false;
      state.inFlight = null;
      const latestBody = canonicalPages.get(pageId)?.markdownBody || '';
      if (latestBody !== state.savedBody) {
        state.timer = window.setTimeout(() => persistMarkdownBody(pageId), 120);
      }
    }
  })();
  state.inFlight = operation;
  return operation;
}

function updateMarkdownBodyFromView(runtime, {
  paneId,
  pageId,
  markdownBody,
  commit = false
} = {}) {
  if (!runtimeIsLive(runtime)
    || (paneId && paneId !== runtime.paneId)
    || runtime.session.activeTab()?.currentPageId !== pageId
    || runtime.currentPage?.id !== pageId) return false;
  if (markdownPageMutationLocks.has(pageId)) return false;
  const page = canonicalPages.get(pageId);
  if (!page || markdownPageModel.normalizePageType(page.type) !== markdownPageModel.PAGE_TYPES.MARKDOWN) {
    return false;
  }
  const body = typeof markdownBody === 'string' ? markdownBody : '';
  const next = { ...page, markdownBody: body };
  canonicalPages.set(pageId, next);
  runtime.currentPage = next;
  syncMarkdownDraftToOtherPanes(pageId, runtime);
  if (runtime === activePaneRuntime()) refreshMarkdownControlStrip(runtime);
  let state = markdownBodySaveStates.get(pageId);
  if (!state) {
    state = {
      timer: 0,
      saving: false,
      inFlight: null,
      savedBody: page.markdownBody || '',
      pendingBody: body
    };
    markdownBodySaveStates.set(pageId, state);
  }
  state.pendingBody = body;
  window.clearTimeout(state.timer);
  state.timer = window.setTimeout(() => persistMarkdownBody(pageId), commit ? 0 : 320);
  return true;
}

async function flushMarkdownBodyPageNow(pageId) {
  const state = markdownBodySaveStates.get(pageId);
  if (!state) return true;
  // A previous body may already be in flight while a newer local draft is
  // waiting. Drain both generations before conversion or another operation
  // that must observe the latest canonical body.
  for (let pass = 0; pass < 3; pass += 1) {
    window.clearTimeout(state.timer);
    state.timer = 0;
    if (state.saving && state.inFlight) await state.inFlight;
    const latestBody = canonicalPages.get(pageId)?.markdownBody || '';
    if (!state.saving && latestBody === state.savedBody) return true;
    await persistMarkdownBody(pageId);
  }
  const latestBody = canonicalPages.get(pageId)?.markdownBody || '';
  return !state.saving && latestBody === state.savedBody;
}

async function flushMarkdownBodySavesNow() {
  for (const state of markdownBodySaveStates.values()) {
    window.clearTimeout(state.timer);
    state.timer = 0;
  }
  // A save already in flight can finish with a newer local edit still pending.
  // Drain that follow-up once more before allowing the desktop window to close.
  for (let pass = 0; pass < 3; pass += 1) {
    const pending = [];
    for (const [pageId, state] of markdownBodySaveStates) {
      const page = canonicalPages.get(pageId);
      if (!page) continue;
      if (state.saving && state.inFlight) pending.push(state.inFlight);
      else if ((page.markdownBody || '') !== state.savedBody) pending.push(persistMarkdownBody(pageId));
    }
    if (!pending.length) return { ok: true };
    await Promise.all(pending);
  }
  const dirty = [...markdownBodySaveStates].some(([pageId, state]) => (
    (canonicalPages.get(pageId)?.markdownBody || '') !== state.savedBody
  ));
  return { ok: !dirty };
}

globalThis.flushMarkdownBodySavesNow = flushMarkdownBodySavesNow;

function commitFocusedMarkdownEditor() {
  const focused = document.activeElement;
  if (focused?.closest?.('.markdown-page-layer, .hn-text-page-layer')
    && typeof focused.blur === 'function') {
    focused.blur();
  }
}

function updatePageIndexFromSavedTitle(page) {
  if (!page?.id || !Array.isArray(pageIndex?.pages)) return null;
  pageIndex = {
    ...pageIndex,
    pages: pageIndex.pages.map((entry) => entry.id === page.id
      ? { ...entry, title: page.title, updatedAt: page.updatedAt || entry.updatedAt }
      : entry)
  };
  return pageIndex.pages.find((entry) => entry.id === page.id) || null;
}

function applySavedPageTitle(savedPage, { originRuntime = null } = {}) {
  if (!savedPage?.id) return savedPage;
  const pageEntry = updatePageIndexFromSavedTitle(savedPage);
  // A title request owns only title and updatedAt. Keep newer local body/layout
  // drafts while adopting the canonical title returned by the serialized API.
  const latest = canonicalPages.get(savedPage.id) || savedPage;
  const canonical = commitCanonicalPage({
    ...savedPage,
    ...latest,
    title: savedPage.title,
    updatedAt: savedPage.updatedAt || latest.updatedAt
  }, { originRuntime });

  globalThis.structuredTextPageShell?.updateBoundTitles?.(
    canonical.id,
    canonical.title,
    { page: canonical }
  );

  for (const runtime of livingPaneRuntimes()) {
    if (runtime.session.activeTab()?.currentPageId !== savedPage.id) continue;
    runtime.currentPage = canonical;
    runtime.currentPageEntry = pageEntry;
    if (runtime.dom.pageTitleDisplay) runtime.dom.pageTitleDisplay.textContent = canonical.title;
    if (runtime.dom.pageTitle) runtime.dom.pageTitle.value = canonical.title;
    updatePaneToolbarPresentation(getWorkspacePane(runtime.paneId));
    if (runtime === originRuntime
      && markdownPageModel.normalizePageType(canonical.type)
        === markdownPageModel.PAGE_TYPES.MARKDOWN) {
      window.markdownPageView?.updateMarkdownPageLayer?.(runtime.dom.canvasStage, { page: canonical });
    }
  }
  const activeRuntime = activePaneRuntime();
  if (activeRuntime?.currentPage?.id === savedPage.id) refreshMarkdownControlStrip(activeRuntime);
  renderPageList();
  return canonical;
}

function performPageTitleSave(intent) {
  return (async () => {
    const ownerRuntime = intent.runtime;
    const ownerCurrent = intent.operation
      ? runtimeOperationIsCurrent(intent.operation)
      : false;
    const page = canonicalPages.get(intent.pageId)
      || (ownerCurrent && ownerRuntime?.currentPage?.id === intent.pageId
        ? ownerRuntime.currentPage
        : null);
    if (!page) throw new Error('Page is no longer available.');
    if (markdownPageMutationLocks.has(intent.pageId)) {
      throw new Error('Page is currently being changed.');
    }
    if (intent.title === page.title) return page;
    const uniqueTitle = makeUniquePageTitle(intent.title, intent.pageId);
    const savedPage = await request(pageApiUrl(intent.pageId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: uniqueTitle })
    });
    return applySavedPageTitle(savedPage, {
      originRuntime: intent.operation && runtimeOperationIsCurrent(intent.operation)
        ? ownerRuntime
        : null
    });
  })();
}

function queuePageTitleSave(intent) {
  const previousSave = pageTitleSaveQueues.get(intent.pageId) || Promise.resolve();
  const operation = previousSave.catch(() => {}).then(() => performPageTitleSave(intent));
  pageTitleSaveQueues.set(intent.pageId, operation);
  operation.then(
    () => {
      if (pendingPageTitleSaves.get(intent.pageId) === intent) {
        pendingPageTitleSaves.delete(intent.pageId);
      }
      if (pageTitleSaveQueues.get(intent.pageId) === operation) {
        pageTitleSaveQueues.delete(intent.pageId);
      }
    },
    (error) => {
      intent.error = error instanceof Error ? error : new Error(String(error));
      if (pageTitleSaveQueues.get(intent.pageId) === operation) {
        pageTitleSaveQueues.delete(intent.pageId);
      }
    }
  );
  return operation;
}

function clearPageTitleSaveState(pageId) {
  if (!pageId) return false;
  const cleared = pendingPageTitleSaves.delete(pageId) || pageTitleSaveQueues.has(pageId);
  pageTitleSaveQueues.delete(pageId);
  return cleared;
}

function discardPagePersistenceState(pageId) {
  if (!pageId) return false;
  const markdownState = markdownBodySaveStates.get(pageId);
  if (markdownState?.timer) window.clearTimeout(markdownState.timer);
  markdownBodySaveStates.delete(pageId);
  clearPageTitleSaveState(pageId);
  globalThis.discardInfoPanelSavesForPage?.(pageId);
  const retained = retainedHnSessionReferences.get(pageId);
  retainedHnSessionReferences.delete(pageId);
  const hnRegistry = hnPageDocumentSessionRegistry;
  if (hnRegistry?.discard) void hnRegistry.discard(pageId, { flush: false });
  else if (hnRegistry?.get?.(pageId)) {
    const session = hnRegistry.get(pageId);
    if (session.saveTimer !== null) clearTimeout(session.saveTimer);
    session.saveTimer = null;
    void session.dispose({ flush: false }).finally(() => hnRegistry.sessions?.delete?.(pageId));
  } else if (retained?.size) scheduleHnSessionReferenceReconcile();
  canonicalPages.delete(pageId);
  return true;
}

function persistPageTitle({
  runtime = null,
  pageId,
  operation = runtime ? captureRuntimeOperation(runtime, {
    scope: 'page-title-persistence', pageId
  }) : null,
  paneId = runtime?.paneId || null,
  title
} = {}) {
  const requestedTitle = String(title || '').trim();
  if (!pageId || !requestedTitle) return Promise.reject(new Error('A non-empty title is required.'));
  const intent = { runtime, operation, paneId, pageId, title: requestedTitle, error: null };
  pendingPageTitleSaves.set(pageId, intent);
  return queuePageTitleSave(intent);
}

function runCommittedPageTitleHistoryMutation({ paneId, pageId, title } = {}) {
  const operation = persistPageTitle({ paneId, pageId, title });
  operation.then((savedPage) => {
    if (getActivePane()?.session.activeTab()?.currentPageId === pageId) {
      showRuntimeStatus(activePaneRuntime(), `Title restored to "${savedPage.title}".`, false, 1800);
    }
  }).catch((error) => {
    if (getActivePane()?.session.activeTab()?.currentPageId === pageId) {
      showRuntimeStatus(activePaneRuntime(), error.message || 'Title could not be restored.', true, 2200);
    }
  });
  return operation;
}

function recordCommittedPageTitleChange({ paneId, pageId, beforeTitle, afterTitle } = {}) {
  const before = String(beforeTitle || '').trim();
  const after = String(afterTitle || '').trim();
  if (!pageId || !before || !after || before === after) return false;
  undoManager.beginContext({
    id: `page-title:${pageId}`,
    type: 'page-title',
    ownerId: pageId
  });
  return undoManager.record({
    undo: () => runCommittedPageTitleHistoryMutation({ paneId, pageId, title: before }),
    redo: () => runCommittedPageTitleHistoryMutation({ paneId, pageId, title: after })
  });
}

async function saveMarkdownDocumentTitle(runtime, {
  pageId,
  title,
  previousTitle = null
} = {}) {
  if (!runtimeIsLive(runtime) || runtime.session.activeTab()?.currentPageId !== pageId) return null;
  const paneId = runtime.paneId;
  const nextTitle = String(title || '').trim();
  const initialPage = canonicalPages.get(pageId) || runtime.currentPage;
  if (!nextTitle || !initialPage || markdownPageMutationLocks.has(pageId)) {
    return initialPage?.title || '';
  }
  const beforeTitle = String(previousTitle || initialPage.title || '').trim();
  if (nextTitle === initialPage.title) return initialPage.title;
  const operation = captureRuntimeOperation(runtime, {
    scope: 'markdown-title-save',
    pageId
  });
  if (runtime === activePaneRuntime()) showRuntimeStatus(runtime, 'Saving…');
  try {
    const savedPage = await persistPageTitle({
      runtime,
      operation,
      paneId,
      pageId,
      title: nextTitle
    });
    recordCommittedPageTitleChange({
      paneId,
      pageId,
      beforeTitle,
      afterTitle: savedPage.title
    });
    if (runtimeOperationIsCurrent(operation) && runtime === activePaneRuntime()) {
      showRuntimeStatus(runtime, savedPage.title === nextTitle
        ? 'Saved'
        : `Saved as "${savedPage.title}".`, false, 1800);
    }
    return savedPage.title;
  } catch (error) {
    if (runtimeOperationIsCurrent(operation) && runtime === activePaneRuntime()) {
      showRuntimeStatus(runtime, error.message, true);
    }
    throw error;
  }
}

function commitFocusedPageTitleEditor() {
  const focused = document.activeElement;
  const structuredTitle = focused?.closest?.(
    '.structured-text-bound-title[contenteditable]:not([contenteditable="false"])'
  );
  if (structuredTitle) {
    structuredTitle.blur();
    return true;
  }
  if (!activePaneRuntime().dom.titleForm?.hidden && activePaneRuntime().currentPage) {
    if (focused === activePaneRuntime().dom.pageTitle) activePaneRuntime().dom.pageTitle.blur();
    else void saveTitle(activePaneRuntime());
    return true;
  }
  return false;
}

async function flushPageTitleSavesNow() {
  // Closing a native window is not guaranteed to dispatch a renderer blur.
  // Materialize the active title draft into the shared queue before draining it.
  commitFocusedPageTitleEditor();
  while (pageTitleSaveQueues.size) {
    await Promise.allSettled([...new Set(pageTitleSaveQueues.values())]);
  }
  // Retain the exact requested title after a failed write. Close-time retries
  // must not silently accept the rolled-back UI or lose the user's intent.
  for (let pass = 0; pass < 2 && pendingPageTitleSaves.size; pass += 1) {
    const pending = [...pendingPageTitleSaves.values()];
    for (const intent of pending) {
      intent.error = null;
      queuePageTitleSave(intent);
    }
    await Promise.allSettled([...new Set(pageTitleSaveQueues.values())]);
  }
  if (!pendingPageTitleSaves.size) return { ok: true };
  const failures = [...pendingPageTitleSaves.values()].map((intent) => ({
    pageId: intent.pageId,
    title: intent.title,
    error: intent.error?.message || String(intent.error || 'Title could not be saved.')
  }));
  return {
    ok: false,
    error: failures.map((failure) => `${failure.pageId}: ${failure.error}`).join('; '),
    failures
  };
}

globalThis.flushPageTitleSavesNow = flushPageTitleSavesNow;
globalThis.flushMarkdownTitleSavesNow = flushPageTitleSavesNow;

function recenterMarkdownDocument(runtime, detail = {}) {
  if (!runtimeIsLive(runtime) || runtime.pageEditMode
    || markdownPageModel.normalizePageType(runtime.currentPage?.type)
      !== markdownPageModel.PAGE_TYPES.MARKDOWN) return;
  if (runtime.markdownRecenterFrame) cancelAnimationFrame(runtime.markdownRecenterFrame);
  const operation = captureRuntimeOperation(runtime, { scope: 'markdown-recenter' });
  const start = runtime.canvasView.offsetX;
  const worldX = Number(detail?.worldX) || 0;
  const target = (runtime.dom.canvasArea.clientWidth / 2) - (worldX * runtime.canvasView.scale);
  const startedAt = performance.now();
  const duration = 170;
  const step = (now) => {
    if (!runtimeOperationIsCurrent(operation)) return;
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - ((1 - progress) ** 3);
    runtime.canvasView.offsetX = start + ((target - start) * eased);
    applyCanvasTransform(runtime);
    if (progress < 1) runtime.markdownRecenterFrame = requestAnimationFrame(step);
    else {
      runtime.markdownRecenterFrame = 0;
      saveActiveTabViewState(runtime);
    }
  };
  runtime.markdownRecenterFrame = requestAnimationFrame(step);
}

function activateMarkdownLink(runtime, { href } = {}) {
  if (!runtimeIsLive(runtime)) return false;
  if (runtime !== activePaneRuntime()) setActiveWorkspacePane(runtime.paneId);
  const url = window.externalLinksModel?.normalizeWebUrl?.(href);
  if (!url) {
    showRuntimeStatus(runtime, 'Only HTTP and HTTPS Markdown links can be opened.', true, 2200);
    return false;
  }
  return openExternalLinkTarget(runtime, { targetKind: 'url', url });
}

function resetPageTypePlaceholderSurface(runtime) {
  runtime.dom.canvasArea?.classList.remove('is-page-type-placeholder');
  if (runtime.dom.canvasStage) {
    runtime.dom.canvasStage.hidden = false;
    runtime.dom.canvasStage.removeAttribute('aria-hidden');
  }
  if (!runtime.dom.emptyCanvas) return;
  runtime.dom.emptyCanvas.classList.remove('is-page-type-placeholder');
  runtime.dom.emptyCanvas.textContent = 'Empty canvas';
  runtime.dom.emptyCanvas.removeAttribute('role');
  runtime.dom.emptyCanvas.removeAttribute('aria-label');
}

function renderCanvasPageContent(runtime, page, { fit = true } = {}) {
  resetPageTypePlaceholderSurface(runtime);
  renderCanvas(runtime, page.objects || [], page.blocks || [], { fit });
}

function renderMarkdownPageContent(runtime, page, { fit = true } = {}) {
  resetPageTypePlaceholderSurface(runtime);
  renderCanvas(runtime, page.objects || [], page.blocks || [], { fit });
}

function renderPageTypePlaceholder(runtime, page, { title, message }) {
  if (typeof resetCanvasImageSession === 'function') resetCanvasImageSession(runtime, page?.id || null);
  if (typeof destroyMarkdownPageLayer === 'function') destroyMarkdownPageLayer(runtime.dom.canvasStage);
  if (typeof destroyHnTextPageLayer === 'function') destroyHnTextPageLayer(runtime.dom.canvasStage);
  runtime.dom.canvasStage?.replaceChildren();
  runtime.dom.canvasStage?.classList.remove('has-highlight-mask');
  if (runtime.dom.canvasStage) {
    runtime.dom.canvasStage.hidden = true;
    runtime.dom.canvasStage.setAttribute('aria-hidden', 'true');
  }
  runtime.canvasObjects = [];
  runtime.canvasBounds = null;
  runtime.hoveredCanvasBlockId = null;
  if (runtime.dom.emptyTabState) runtime.dom.emptyTabState.hidden = true;
  runtime.dom.canvasArea?.classList.add('is-page-type-placeholder');
  if (runtime.dom.emptyCanvas) {
    runtime.dom.emptyCanvas.classList.add('is-page-type-placeholder');
    runtime.dom.emptyCanvas.textContent = `${title}\n${message}`;
    runtime.dom.emptyCanvas.setAttribute('role', 'status');
    runtime.dom.emptyCanvas.setAttribute('aria-label', `${title}. ${message}`);
    runtime.dom.emptyCanvas.hidden = false;
  }
}

function renderHnTextPageContent(runtime, page, { fit = true } = {}) {
  resetPageTypePlaceholderSurface(runtime);
  renderCanvas(runtime, page.objects || [], page.blocks || [], { fit });
}

const pageRendererAdapters = new Map([
  ['canvas', renderCanvasPageContent],
  ['markdown', renderMarkdownPageContent],
  ['cne-text', renderHnTextPageContent]
]);

function pageRendererAdapter(page) {
  const adapter = pageRendererAdapters.get(pageTypesModel.pageTypeRendererId(page?.type));
  if (!adapter) throw new Error(`Unsupported Page Type: ${page?.type ?? 'invalid'}.`);
  return adapter;
}

function renderPageContent(runtime, page, options = {}) {
  if (!runtimeIsLive(runtime) || !page) return false;
  runtime.mounted = {
    generation: (runtime.mounted?.generation || 0) + 1,
    pageId: page.id,
    kind: pageTypesModel.pageTypeRendererId(page.type)
  };
  return pageRendererAdapter(page)(runtime, page, options);
}

function renderPage(runtime, page, { resetCanvas = true, installCanonical = true } = {}) {
  if (!runtimeIsLive(runtime) || !page) return false;
  if (runtime.dom.emptyTabState) runtime.dom.emptyTabState.hidden = true;
  runtime.currentPage = installCanonical
    ? commitCanonicalPage(page, { originRuntime: runtime })
    : page;
  page = runtime.currentPage;
  runtime.currentPageEntry = pageIndex?.pages?.find((entry) => entry.id === page.id) || null;
  runtime.dom.pageTitleDisplay.textContent = page.title;
  runtime.dom.pageTitle.value = page.title;
  closeTitleEditor(runtime);
  if (resetCanvas) renderPageContent(runtime, page, { fit: true });
  updateEditAvailability(runtime);
  setPaneInfoPanelsAvailable(runtime, page);
  updatePaneToolbarPresentation(getWorkspacePane(runtime.paneId));

  if (runtime === activePaneRuntime()) {
    renderMaintenanceResources(runtime, page);
    renderExternalLinks(runtime, page);
    renderRelations(runtime, page);
    addFileButton.disabled = !pageSupportsFileImport(page) || !desktopAddFileAvailable();
    for (const button of pageList.querySelectorAll('.page-link')) {
      button.classList.toggle(
        'active', !navigationExplicitSelectionMode && button.dataset.pageId === page.id
      );
    }
    refreshMarkdownControlStrip(runtime);
  }

  // Future block, link, and descriptor renderers will attach to this page state.
  return true;
}

function setEditMenuOpen(runtime, active) {
  if (!runtimeIsLive(runtime)) return false;
  const shouldOpen = active && !runtime.blockEditMode && !runtime.pageEditMode
    && !runtime.highlightEditDraft && pageIsSupported(runtime.currentPage);
  if (shouldOpen) {
    closeAddLinkPopover(runtime);
    closeHighlightMenus();
  }
  runtime.dom.editMenu.hidden = !shouldOpen;
  runtime.dom.editBlockButton.setAttribute('aria-expanded', String(shouldOpen));
  if (!shouldOpen) {
    if (runtime.dom.pageTypeSubmenu) runtime.dom.pageTypeSubmenu.hidden = true;
    runtime.dom.pageTypeMenuTrigger?.setAttribute('aria-expanded', 'false');
    runtime.dom.editMenu.style.removeProperty('left');
    runtime.dom.editMenu.style.removeProperty('top');
    return false;
  }
  const anchorRect = runtime.dom.editBlockButton.getBoundingClientRect();
  const menuWidth = Math.max(155, runtime.dom.editMenu.offsetWidth);
  const left = Math.max(8, Math.min(
    anchorRect.right - menuWidth,
    window.innerWidth - menuWidth - 8
  ));
  runtime.dom.editMenu.style.left = `${left}px`;
  runtime.dom.editMenu.style.top = `${Math.min(window.innerHeight - 8, anchorRect.bottom + 6)}px`;
  return true;
}

function setPageTypeSubmenuOpen(runtime, active) {
  if (!runtimeIsLive(runtime) || !runtime.dom.pageTypeSubmenu
    || !runtime.dom.pageTypeMenuTrigger || runtime.dom.pageTypeMenuTrigger.disabled) return;
  const shouldOpen = Boolean(active) && !runtime.dom.editMenu.hidden;
  if (shouldOpen) updatePanePageTypeMenu(getWorkspacePane(runtime.paneId), runtime.currentPage);
  runtime.dom.pageTypeSubmenu.hidden = !shouldOpen;
  runtime.dom.pageTypeMenuTrigger.setAttribute('aria-expanded', String(shouldOpen));
  if (!shouldOpen) return;
  const anchorRect = runtime.dom.pageTypeMenuTrigger.getBoundingClientRect();
  const menuWidth = Math.max(150, runtime.dom.pageTypeSubmenu.offsetWidth);
  const left = Math.min(window.innerWidth - menuWidth - 8, anchorRect.right + 4);
  runtime.dom.pageTypeSubmenu.style.left = `${Math.max(8, left)}px`;
  runtime.dom.pageTypeSubmenu.style.top = `${Math.max(8, Math.min(
    anchorRect.top,
    window.innerHeight - runtime.dom.pageTypeSubmenu.offsetHeight - 8
  ))}px`;
}

function closeHighlightMenus(exceptPaneId = null) {
  for (const pane of workspace.state.panes) {
    if (pane.id === exceptPaneId) continue;
    const dom = pane.viewContext?.dom;
    if (!dom?.highlightMenu) continue;
    dom.highlightMenu.hidden = true;
    dom.highlightButton?.setAttribute('aria-expanded', 'false');
  }
}

function positionHighlightMenu(pane) {
  const dom = pane?.viewContext?.dom;
  if (!dom?.highlightMenu || !dom.highlightButton) return;
  const anchorRect = dom.highlightButton.getBoundingClientRect();
  const menuWidth = Math.max(210, dom.highlightMenu.offsetWidth);
  const menuHeight = dom.highlightMenu.offsetHeight;
  const left = Math.max(8, Math.min(
    anchorRect.right - menuWidth,
    window.innerWidth - menuWidth - 8
  ));
  dom.highlightMenu.style.left = `${left}px`;
  dom.highlightMenu.style.top = `${Math.max(8, Math.min(
    anchorRect.bottom + 6,
    window.innerHeight - menuHeight - 8
  ))}px`;
}

function beginHighlightGroupRename(runtime, group, nameElement) {
  if (!runtimeIsLive(runtime) || !group || !nameElement) return;
  const pane = getWorkspacePane(runtime.paneId);
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'highlight-group-rename-input';
  input.value = group.name;
  input.setAttribute('aria-label', `Rename ${group.name}`);
  nameElement.replaceWith(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = async (save) => {
    if (finished) return;
    finished = true;
    const nextName = input.value.trim();
    if (save && nextName && nextName !== group.name) {
      await renameHighlightGroup(runtime, group.id, nextName);
    } else {
      renderHighlightMenu(runtime);
      positionHighlightMenu(pane);
    }
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter'
      && globalThis.textEditingModel?.isImeCompositionOwnedKeyEvent?.(event, input)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    }
  });
}

function renderHighlightMenu(runtime) {
  if (!runtimeIsLive(runtime)) return;
  const pane = getWorkspacePane(runtime.paneId);
  const dom = runtime.dom;
  const menu = dom?.highlightMenu;
  if (!pane || !menu) return;
  const tab = pane.session.activeTab();
  const page = pageForWorkspacePane(pane);
  const groups = Array.isArray(page?.highlightGroups) ? page.highlightGroups : [];
  const checked = new Set(checkedHighlightGroupIdsForViewState(tab?.viewState));
  menu.replaceChildren();

  for (const group of groups) {
    const row = document.createElement('div');
    row.className = 'highlight-group-row';
    row.dataset.highlightGroupId = group.id;
    const label = document.createElement('label');
    label.className = 'highlight-group-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checked.has(group.id);
    checkbox.setAttribute('aria-label', `Show ${group.name}`);
    const name = document.createElement('span');
    name.className = 'highlight-group-name';
    name.textContent = group.name;
    label.append(checkbox, name);
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'highlight-group-more';
    more.textContent = '…';
    more.setAttribute('aria-label', `Actions for ${group.name}`);
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    const actions = document.createElement('div');
    actions.className = 'highlight-group-actions';
    actions.setAttribute('role', 'menu');
    actions.hidden = true;
    for (const [action, text] of [
      ['rename', 'Rename'],
      ['adjust', 'Adjust'],
      ['edit-info', 'Edit Info'],
      ['delete', 'Delete']
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'highlight-group-action';
      button.dataset.highlightGroupAction = action;
      button.setAttribute('role', 'menuitem');
      button.textContent = text;
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (getActivePane()?.id !== pane.id) setActiveWorkspacePane(pane.id);
        if (action === 'rename') {
          actions.hidden = true;
          more.setAttribute('aria-expanded', 'false');
          beginHighlightGroupRename(runtime, group, name);
        }
        else if (action === 'adjust') beginAdjustHighlightGroup(runtime, group.id);
        else if (action === 'edit-info') {
          setHighlightMenuOpen(runtime, false);
          if (typeof openHighlightGroupInfoEditor === 'function') {
            openHighlightGroupInfoEditor(runtime, group.id);
          }
        }
        else await deleteHighlightGroup(runtime, group.id);
      });
      actions.append(button);
    }
    checkbox.addEventListener('change', () => {
      if (getActivePane()?.id !== pane.id) setActiveWorkspacePane(pane.id);
      toggleHighlightGroupForCurrentTab(runtime, group.id, checkbox.checked);
    });
    name.addEventListener('dblclick', (event) => {
      event.preventDefault();
      beginHighlightGroupRename(runtime, group, name);
    });
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      const opening = actions.hidden;
      for (const other of menu.querySelectorAll('.highlight-group-actions')) other.hidden = true;
      for (const other of menu.querySelectorAll('.highlight-group-more')) {
        other.setAttribute('aria-expanded', 'false');
      }
      actions.hidden = !opening;
      more.setAttribute('aria-expanded', String(opening));
    });
    row.append(label, more, actions);
    menu.append(row);
  }

  const separator = document.createElement('div');
  separator.className = 'highlight-menu-separator';
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'highlight-menu-add';
  add.textContent = '+ Add';
  add.setAttribute('role', 'menuitem');
  add.addEventListener('click', () => {
    if (getActivePane()?.id !== pane.id) setActiveWorkspacePane(pane.id);
    beginNewHighlightGroup(runtime);
  });
  menu.append(separator, add);
}

function setHighlightMenuOpen(runtime, active) {
  if (!runtimeIsLive(runtime)) return false;
  const pane = getWorkspacePane(runtime.paneId);
  const dom = runtime.dom;
  if (!dom?.highlightMenu || !dom.highlightButton) return false;
  const page = pageForWorkspacePane(pane);
  const shouldOpen = Boolean(active && page && !runtime.blockEditMode && !runtime.pageEditMode
    && !runtime.highlightEditDraft);
  closeHighlightMenus(shouldOpen ? pane.id : null);
  if (shouldOpen) {
    if (getActivePane()?.id !== pane.id) setActiveWorkspacePane(pane.id);
    setEditMenuOpen(runtime, false);
    renderHighlightMenu(runtime);
  }
  dom.highlightMenu.hidden = !shouldOpen;
  dom.highlightButton.setAttribute('aria-expanded', String(shouldOpen));
  if (shouldOpen) positionHighlightMenu(pane);
  else {
    dom.highlightMenu.style.removeProperty('left');
    dom.highlightMenu.style.removeProperty('top');
  }
  return shouldOpen;
}

function isTextEditingElement(element) {
  if (globalThis.textEditingModel?.isEditableTarget
    && globalThis.textEditingModel.isEditableTarget(element, document.activeElement)) return true;
  return element instanceof Element
    && Boolean(element.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
    ));
}

function applicationUndoShortcut(event) {
  if (event.repeat || event.isComposing || event.keyCode === 229 || event.altKey) return null;
  const key = String(event.key || '').toLowerCase();
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  const macOS = /mac/i.test(platform);
  const primaryModifier = macOS
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  if (!primaryModifier) return null;
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (!macOS && key === 'y' && !event.shiftKey) return 'redo';
  return null;
}

function handleApplicationUndoRedo(event) {
  const direction = applicationUndoShortcut(event);
  if (!direction) return false;
  if (isTextEditingElement(event.target) || isTextEditingElement(document.activeElement)) return false;
  const handled = direction === 'undo' ? undoManager.undo() : undoManager.redo();
  if (!handled) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

function pageHistoryShortcut(event) {
  if (event.repeat || event.isComposing || event.keyCode === 229) return null;
  const noModifiers = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
  if (noModifiers && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    return { direction: event.key === 'ArrowLeft' ? -1 : 1, plain: true };
  }
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  const macOS = /mac/i.test(platform);
  if (macOS && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
    && (event.key === '[' || event.key === ']')) {
    return { direction: event.key === '[' ? -1 : 1, plain: false };
  }
  if (!macOS && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey
    && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    return { direction: event.key === 'ArrowLeft' ? -1 : 1, plain: false };
  }
  return null;
}

function pageHistoryNavigationBlocked(runtime) {
  return Boolean(
    pageMetaModal
    || vaultSettingsOpen
    || runtime?.linkPickMode
    || navigationMoveMode
    || !addLinkPopover.hidden
    || !blockLinkChoicePopover.hidden
    || !externalLinkSidebarPopover.hidden
    || Boolean(runtime?.dom.highlightMenu && !runtime.dom.highlightMenu.hidden)
    || document.querySelector('.forced-modal-overlay:not([hidden])')
  );
}

function pageHistoryShortcutBlocked(runtime, event, shortcut) {
  if (!shortcut || !runtimeIsLive(runtime) || runtime.pageHistoryNavigationInProgress
    || !runtime.currentPage) return true;
  if (isTextEditingElement(event.target) || isTextEditingElement(document.activeElement)) return true;
  if (shortcut.plain && (runtime.blockEditMode || runtime.pageEditMode
    || runtime.highlightEditDraft)) return true;
  return pageHistoryNavigationBlocked(runtime);
}

function handlePageHistoryKeyDown(event) {
  const runtime = activePaneRuntime();
  const shortcut = pageHistoryShortcut(event);
  if (pageHistoryShortcutBlocked(runtime, event, shortcut)) return false;
  if (!pageHistoryTarget(runtime, shortcut.direction)) return false;
  event.preventDefault();
  navigatePageHistory(runtime, shortcut.direction);
  return true;
}

function caretOffsetAtClick(runtime, event) {
  const textNode = runtime.dom.pageTitleDisplay.firstChild;
  if (!textNode || !textNode.textContent) return 0;

  const range = document.createRange();
  let closestOffset = textNode.textContent.length;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let offset = 0; offset <= textNode.textContent.length; offset += 1) {
    range.setStart(textNode, offset);
    range.setEnd(textNode, offset);
    const distance = Math.abs(event.clientX - range.getBoundingClientRect().left);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestOffset = offset;
    }
  }

  return closestOffset;
}

function beginTitleEditor(runtime, { caretOffset = null, selectAll = false } = {}) {
  if (!runtimeIsLive(runtime) || !pageIsSupported(runtime.currentPage)
    || runtime.blockEditMode || runtime.pageEditMode || runtime.highlightEditDraft
    || markdownPageMutationLocks.has(runtime.currentPage.id)) return;
  runtime.dom.pageTitle.value = runtime.currentPage.title;
  runtime.dom.pageTitleDisplay.hidden = true;
  runtime.dom.titleForm.hidden = false;
  runtime.dom.pageTitle.focus();

  if (selectAll) runtime.dom.pageTitle.select();
  else {
    const offset = Number.isInteger(caretOffset) ? caretOffset : runtime.dom.pageTitle.value.length;
    runtime.dom.pageTitle.setSelectionRange(offset, offset);
  }

  updateTitleDuplicateWarning(runtime);
}

function beginNewPageTitleEditor(runtime, page) {
  const pageType = pageTypesModel.normalizePageType(page?.type);
  const isStructuredText = pageType === pageTypesModel.PAGE_TYPES.MARKDOWN
    || pageType === pageTypesModel.PAGE_TYPES.HN_TEXT;
  if (!isStructuredText) {
    beginTitleEditor(runtime, { selectAll: true });
    return;
  }

  closeTitleEditor(runtime);
  const pageId = page?.id || null;
  const operation = captureRuntimeOperation(runtime, {
    scope: 'new-page-title-focus',
    pageId,
    requireMount: true
  });
  const focusStructuredTitle = () => {
    if (!pageId || !runtimeOperationIsCurrent(operation) || runtime.currentPage?.id !== pageId) {
      return false;
    }
    return globalThis.structuredTextPageShell?.focusBoundTitleForStage?.(
      runtime.dom.canvasStage,
      { selectAll: true }
    ) === true;
  };
  if (!focusStructuredTitle()) requestAnimationFrame(focusStructuredTitle);
}

function openTitleEditor(runtime, event) {
  if (pageMetaModal) return;
  beginTitleEditor(runtime, { caretOffset: caretOffsetAtClick(runtime, event) });
}

function closeTitleEditor(runtime) {
  if (!runtime?.dom) return;
  runtime.dom.titleForm.hidden = true;
  runtime.dom.pageTitleDisplay.hidden = false;
  if (runtime.currentPage) runtime.dom.pageTitle.value = runtime.currentPage.title;
}

async function persistLastOpenedPage(pageId) {
  if (project.lastOpenedPageId === pageId) return;

  project = await request('/api/project', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lastOpenedPageId: pageId })
  });
}

function pageHistoryEntryExists(pageId) {
  return Boolean(pageIndex?.pages?.some((page) => page.id === pageId));
}

function pageHistoryTarget(runtime, direction, fromIndex = undefined) {
  return runtime?.session?.historyTarget(direction, pageHistoryEntryExists, fromIndex) || null;
}

function activeTab(runtime) {
  return runtime?.session?.activeTab?.() || null;
}

function pageTitleForTab(tab) {
  if (!tab?.currentPageId) return 'New Tab';
  return canonicalPages.get(tab.currentPageId)?.title
    || pageIndex?.pages?.find((page) => page.id === tab.currentPageId)?.title
    || 'Missing Page';
}

function canonicalDragPageTitle(pageId) {
  if (!pageId) return 'New Tab';
  return canonicalPages.get(pageId)?.title
    || pageIndex?.pages?.find((page) => page.id === pageId)?.title
    || 'Missing Page';
}

function ensureTabTitleTooltipBubble() {
  if (tabTitleTooltipBubble?.isConnected) return tabTitleTooltipBubble;
  tabTitleTooltipBubble = document.createElement('div');
  tabTitleTooltipBubble.id = 'viewer-tab-title-tooltip';
  tabTitleTooltipBubble.className = 'viewer-tab-tooltip system-typography';
  tabTitleTooltipBubble.setAttribute('role', 'tooltip');
  tabTitleTooltipBubble.hidden = true;
  document.body.append(tabTitleTooltipBubble);
  return tabTitleTooltipBubble;
}

function clearTabTitleTooltip() {
  if (tabTitleTooltipTimer) window.clearTimeout(tabTitleTooltipTimer);
  tabTitleTooltipTimer = 0;
  tabTitleTooltipAnchor = null;
  if (tabTitleTooltipBubble) tabTitleTooltipBubble.hidden = true;
}

function positionTabTitleTooltip(anchor) {
  const bubble = tabTitleTooltipBubble;
  if (!bubble || bubble.hidden || anchor !== tabTitleTooltipAnchor || !anchor.isConnected) return;
  const anchorRect = anchor.getBoundingClientRect();
  const bubbleRect = bubble.getBoundingClientRect();
  const edge = 8;
  const gap = 6;
  const idealLeft = anchorRect.left + ((anchorRect.width - bubbleRect.width) / 2);
  const left = Math.min(Math.max(edge, idealLeft), Math.max(edge, window.innerWidth - edge - bubbleRect.width));
  const below = anchorRect.bottom + gap;
  const top = below + bubbleRect.height <= window.innerHeight - edge
    ? below
    : Math.max(edge, anchorRect.top - gap - bubbleRect.height);
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
}

function scheduleTabTitleTooltip(anchor) {
  if (tabReorderState?.started) return;
  clearTabTitleTooltip();
  tabTitleTooltipAnchor = anchor;
  tabTitleTooltipTimer = window.setTimeout(() => {
    tabTitleTooltipTimer = 0;
    if (anchor !== tabTitleTooltipAnchor || !anchor.isConnected) return;
    const bubble = ensureTabTitleTooltipBubble();
    bubble.textContent = anchor.dataset.fullTitle || '';
    bubble.hidden = false;
    positionTabTitleTooltip(anchor);
  }, TAB_TITLE_TOOLTIP_DELAY);
}

function suppressNextTabClick(tabId, delay = 0) {
  if (tabReorderSuppressedClickTimer) window.clearTimeout(tabReorderSuppressedClickTimer);
  tabReorderSuppressedClickId = tabId;
  tabReorderSuppressedClickTimer = window.setTimeout(() => {
    tabReorderSuppressedClickId = null;
    tabReorderSuppressedClickTimer = 0;
  }, delay);
}

function consumeSuppressedTabClick(tabId) {
  if (tabReorderSuppressedClickId !== tabId) return false;
  if (tabReorderSuppressedClickTimer) window.clearTimeout(tabReorderSuppressedClickTimer);
  tabReorderSuppressedClickId = null;
  tabReorderSuppressedClickTimer = 0;
  return true;
}

function applyTabTitlePresentation(element, fullTitle, { minimum = false, compact = false } = {}) {
  const title = element.querySelector('.viewer-tab-title');
  element.dataset.fullTitle = fullTitle;
  element.dataset.titleMinimum = String(minimum);
  element.dataset.titleCompact = String(compact || minimum);
  title.textContent = minimum ? tabStripLayoutModel.firstGrapheme(fullTitle) : fullTitle;
  title.removeAttribute('title');
}

function tabTitleTextWidth(titleElement, text) {
  if (!tabTitleMeasureContext) {
    tabTitleMeasureContext = document.createElement('canvas').getContext('2d');
  }
  if (!tabTitleMeasureContext) return String(text).length * 8;
  const style = window.getComputedStyle(titleElement);
  tabTitleMeasureContext.font = style.font || [
    style.fontWeight,
    style.fontSize,
    style.fontFamily
  ].filter(Boolean).join(' ');
  return tabTitleMeasureContext.measureText(text).width;
}

function inactiveTabCanRevealClose(element, width, fullTitle) {
  const title = element.querySelector('.viewer-tab-title');
  if (!title || width <= tabStripLayoutModel.MINIMUM_INACTIVE_TAB_WIDTH) return false;
  const style = window.getComputedStyle(title);
  const horizontalPadding = Number.parseFloat(style.paddingLeft || 0)
    + Number.parseFloat(style.paddingRight || 0);
  const threeGraphemes = tabStripLayoutModel.firstGraphemes(fullTitle, 3);
  const firstGrapheme = tabStripLayoutModel.firstGrapheme(fullTitle);
  const restingThreshold = horizontalPadding + tabTitleTextWidth(title, `${threeGraphemes}…`);
  const hoveredThreshold = 40 + tabTitleTextWidth(title, `${firstGrapheme}…`);
  return width >= Math.max(restingThreshold, hoveredThreshold);
}

function ensureActiveTabVisible(list, { smooth = false } = {}) {
  const active = list?.querySelector('.viewer-tab[data-active="true"]');
  if (!active) return;
  const plus = list.querySelector('.viewer-tab-add');
  const shoulder = tabStripLayoutModel.MINIMUM_INACTIVE_TAB_WIDTH > 0 ? 8 : 0;
  const left = Math.max(0, active.offsetLeft - shoulder);
  const trailingElement = active.nextElementSibling === plus ? plus : active;
  const right = trailingElement.offsetLeft + trailingElement.offsetWidth + shoulder;
  const visibleLeft = list.scrollLeft;
  const visibleRight = visibleLeft + list.clientWidth;
  if (left < visibleLeft) list.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
  else if (right > visibleRight) {
    list.scrollTo({ left: right - list.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
  }
}

function paneTabRegion(paneId) {
  return topTabArea?.querySelector(
    `.workspace-pane-tab-region[data-workspace-pane-id="${CSS.escape(paneId)}"]`
  ) || null;
}

function paneTabStrip(paneId) {
  return paneTabRegion(paneId)?.querySelector('.viewer-tab-strip') || null;
}

function tabStripIdForPane(paneId) {
  return `workspace-strip-${paneId}`;
}

function activePaneTabStrip() {
  return paneTabStrip(getActivePane()?.id || 'main-pane');
}

function updateTabStripLayout({
  ensureActiveVisible = false,
  smooth = false,
  preserveLeftAnchor = false,
  preserveTitlePresentation = false,
  provisionalInactiveTabCount = null,
  provisionalTabWillBeActive = null,
  paneId = null,
  strip: requestedStrip = null
} = {}) {
  const strip = requestedStrip || paneTabStrip(paneId || getActivePane()?.id);
  const list = strip?.querySelector('.viewer-tab-list');
  if (!strip || !list) return;
  const tabs = [...list.querySelectorAll('.viewer-tab')];
  const inferredProvisionalCount = tabReorderState?.commitMode === 'create-new-tab'
    && tabReorderState.phase === 'reordering'
    && tabReorderState.sidebarStripParticipationActive !== false
    && tabReorderState.strip === strip
    ? 1
    : 0;
  const provisionalCount = Math.max(0, Math.floor(Number.isFinite(provisionalInactiveTabCount)
    ? provisionalInactiveTabCount
    : inferredProvisionalCount));
  const provisionalWillBeActive = typeof provisionalTabWillBeActive === 'boolean'
    ? provisionalTabWillBeActive
    : inferredProvisionalCount > 0;
  const layoutTabCount = tabs.length + provisionalCount;
  const plus = strip.querySelector('.viewer-tab-add');
  const menu = strip.querySelector('.viewer-tab-menu');
  const stripStyle = window.getComputedStyle(strip);
  const listStyle = window.getComputedStyle(list);
  const menuStyle = menu ? window.getComputedStyle(menu) : null;
  const stripHorizontalPadding = Number.parseFloat(stripStyle.paddingLeft || 0)
    + Number.parseFloat(stripStyle.paddingRight || 0);
  const listHorizontalPadding = Number.parseFloat(listStyle.paddingLeft || 0)
    + Number.parseFloat(listStyle.paddingRight || 0);
  const menuOuterWidth = (menu?.offsetWidth || 0)
    + Number.parseFloat(menuStyle?.marginLeft || 0)
    + Number.parseFloat(menuStyle?.marginRight || 0);
  const maximumListWidth = Math.max(
    0,
    strip.clientWidth - stripHorizontalPadding - menuOuterWidth
  );
  const maximumTabsWidth = Math.max(
    0,
    maximumListWidth - listHorizontalPadding - (plus?.offsetWidth || 0)
  );
  const preferredTabsWidth = layoutTabCount * tabStripLayoutModel.PREFERRED_TAB_WIDTH;
  const tabSpace = Math.min(
    preferredTabsWidth,
    maximumTabsWidth
  );
  const listWidth = maximumListWidth;
  list.style.setProperty('--viewer-tab-list-width', `${listWidth}px`);
  const sizing = tabStripLayoutModel.calculateTabSizing({
    availableWidth: tabSpace,
    tabCount: layoutTabCount,
    hasActiveTab: tabs.some((element) => element.dataset.active === 'true')
      || provisionalWillBeActive
  });
  const renderedActiveWidth = provisionalWillBeActive && provisionalCount > 0
    ? sizing.inactiveWidth
    : sizing.activeWidth;
  list.style.setProperty('--viewer-tab-active-width', `${renderedActiveWidth}px`);
  list.style.setProperty('--viewer-tab-inactive-width', `${sizing.inactiveWidth}px`);
  list.dataset.overflow = String(sizing.scrolling);
  const minimum = tabStripLayoutModel.MINIMUM_INACTIVE_TAB_WIDTH;
  for (const element of tabs) {
    const active = element.dataset.active === 'true';
    const atMinimum = !active && sizing.inactiveWidth <= minimum + 0.5;
    const compact = !active && sizing.inactiveWidth < 72;
    const fullTitle = element.dataset.fullTitle || '';
    if (!preserveTitlePresentation) {
      applyTabTitlePresentation(element, fullTitle, {
        minimum: atMinimum,
        compact
      });
      const closeOnHover = !active
        && inactiveTabCanRevealClose(element, sizing.inactiveWidth, fullTitle);
      element.dataset.closeOnHover = String(closeOnHover);
      const close = element.querySelector('.viewer-tab-close');
      if (close) close.tabIndex = active || closeOnHover ? 0 : -1;
    }
  }
  if (!preserveLeftAnchor && (ensureActiveVisible || sizing.scrolling)) {
    ensureActiveTabVisible(list, { smooth });
  }
  return {
    ...sizing,
    provisionalTabWidth: provisionalWillBeActive && provisionalCount > 0
      ? sizing.activeWidth
      : sizing.inactiveWidth
  };
}

function scheduleTabStripLayout(options = {}) {
  if (tabStripLayoutFrame) window.cancelAnimationFrame(tabStripLayoutFrame);
  tabStripLayoutFrame = window.requestAnimationFrame(() => {
    tabStripLayoutFrame = 0;
    if (options.paneId || options.strip) updateTabStripLayout(options);
    else {
      for (const pane of workspace.state.panes) {
        updateTabStripLayout({
          ...options,
          paneId: pane.id,
          ensureActiveVisible: options.ensureActiveVisible && pane.id === workspace.state.activePaneId
        });
      }
    }
  });
}

function observeTabStrip(strip) {
  if (!strip || typeof ResizeObserver !== 'function') return;
  if (!tabStripResizeObserver) {
    tabStripResizeObserver = new ResizeObserver(() => {
      clearTabTitleTooltip();
      const paneResizeActive = Boolean(paneDividerDragState);
      scheduleTabStripLayout({
        ensureActiveVisible: !paneResizeActive,
        preserveLeftAnchor: paneResizeActive,
        preserveTitlePresentation: paneResizeActive
      });
    });
  }
  tabStripResizeObserver.observe(strip);
}

function clearTabReorderSettleAnimation() {
  if (tabReorderSettleFrame) window.cancelAnimationFrame(tabReorderSettleFrame);
  tabReorderSettleFrame = 0;
  if (tabReorderSettleTimer) window.clearTimeout(tabReorderSettleTimer);
  tabReorderSettleTimer = 0;
  for (const visual of tabStripClosingVisuals) visual.remove();
  tabStripClosingVisuals.clear();
  const strip = activePaneTabStrip();
  for (const element of strip?.querySelectorAll('.viewer-tab') || []) {
    element.classList.remove(
      'is-tab-inserting',
      'is-tab-reorder-flip',
      'is-tab-reorder-settling'
    );
    if (!element.classList.contains('is-tab-reorder-dragging')
      && !element.classList.contains('is-tab-reorder-displaced')) {
      element.style.transform = '';
    }
    element.style.flexBasis = '';
    element.style.width = '';
    element.style.minWidth = '';
    element.style.maxWidth = '';
  }
  const plus = strip?.querySelector('.viewer-tab-add');
  plus?.classList.remove(
    'is-tab-layout-transitioning',
    'is-tab-reorder-flip',
    'is-tab-reorder-settling'
  );
  if (plus && !plus.classList.contains('is-tab-reorder-displaced')) {
    plus.style.transform = '';
  }
  if (plus) plus.style.left = '';
}

function getRegisteredTabStrips() {
  const strips = [];
  for (const pane of workspace.state.panes) {
    const element = paneTabStrip(pane.id);
    const list = element?.querySelector('.viewer-tab-list');
    if (!element || !list) continue;
    element.dataset.tabStripId = tabStripIdForPane(pane.id);
    strips.push({
      stripId: element.dataset.tabStripId,
      ownerPaneId: pane.id,
      element,
      list,
      tabOrder: pane.session.tabs().map((tab) => tab.id),
      bounds: list.getBoundingClientRect(),
      scrollOffset: list.scrollLeft
    });
  }
  return strips;
}

function hitTestTabStrip(clientX, clientY) {
  return getRegisteredTabStrips().find(({ bounds }) => (
    clientX >= bounds.left
    && clientX <= bounds.right
    && clientY >= bounds.top
    && clientY <= bounds.bottom
  )) || null;
}

function hitTestTabStripInterior(clientX, clientY) {
  return getRegisteredTabStrips().find(({ bounds }) => {
    const verticalInset = Math.min(4, bounds.height * 0.12);
    return clientX >= bounds.left
      && clientX <= bounds.right
      && clientY >= bounds.top + verticalInset
      && clientY <= bounds.bottom - verticalInset;
  }) || null;
}

function tabPreviewResourceUrl(pageId, object) {
  const location = resourceLocationsModel.tryNormalizeResourceLocation(object);
  if (location && location.type !== 'vault') {
    return pageApiUrl(pageId, `/resources/${encodeURIComponent(object.id)}/content`);
  }
  const version = object.updatedAt || object.cacheBuster || object.contentHash;
  if (!object.src || !version) return object.src || '';
  const separator = object.src.includes('?') ? '&' : '?';
  return `${object.src}${separator}v=${encodeURIComponent(version)}`;
}

async function resolveTabPreviewImageSource(pageId, object, requiredLongEdge) {
  if (typeof globalThis.cneDesktop?.requestDisplayProxy === 'function') {
    try {
      const response = await globalThis.cneDesktop.requestDisplayProxy({
        pageId,
        objectId: object.id,
        requiredLongEdge
      });
      if (response?.ok && response.variant?.displayUrl) return response.variant.displayUrl;
    } catch {
      // Fall through to the canonical resource URL.
    }
  }
  return tabPreviewResourceUrl(pageId, object);
}

async function loadTabPreviewPage(tab) {
  if (!tab?.currentPageId) return null;
  if (canonicalPages.has(tab.currentPageId)) return canonicalPages.get(tab.currentPageId);
  const page = await request(pageApiUrl(tab.currentPageId));
  canonicalPages.set(page.id, page);
  return page;
}

async function renderImageTabPagePreview(preview, tab, page, geometry) {
  const stage = document.createElement('div');
  stage.className = 'tab-page-preview-stage';
  const rects = tabPagePreviewModel.previewObjectRects(page.objects, {
    viewportWidth: geometry.viewportWidth,
    viewportHeight: geometry.viewportHeight,
    previewWidth: geometry.width,
    previewHeight: geometry.height,
    padding: CANVAS_FIT_PADDING
  });
  preview.append(stage);
  const imageReady = [];
  for (const entry of rects) {
    const image = document.createElement('img');
    image.className = 'tab-page-preview-object';
    image.alt = '';
    image.draggable = false;
    image.style.left = `${entry.left}px`;
    image.style.top = `${entry.top}px`;
    image.style.width = `${entry.width}px`;
    image.style.height = `${entry.height}px`;
    stage.append(image);
    const requiredLongEdge = Math.max(entry.width, entry.height)
      * Math.max(1, globalThis.devicePixelRatio || 1);
    image.hidden = true;
    imageReady.push(resolveTabPreviewImageSource(page.id, entry.object, requiredLongEdge)
      .then((source) => new Promise((resolve) => {
        if (!source || !image.isConnected || !preview.isConnected) {
          image.remove();
          resolve();
          return;
        }
        image.addEventListener('load', () => {
          if (image.isConnected) image.hidden = false;
          resolve();
        }, { once: true });
        image.addEventListener('error', () => {
          image.remove();
          resolve();
        }, { once: true });
        image.src = source;
      })).catch(() => image.remove()));
  }
  Promise.allSettled(imageReady).then(() => {
    if (stage.isConnected) stage.classList.add('is-content-ready');
  });
}

function renderMarkdownTabPagePreview(preview, tab, page, geometry) {
  // Markdown Pages still share the Canvas object plane. Reuse the canonical
  // image-preview pipeline so managed image Objects keep their Page geometry
  // underneath the document surface instead of disappearing from the drag
  // preview.
  renderImageTabPagePreview(preview, tab, page, geometry);
  const documentPreview = document.createElement('article');
  documentPreview.className = 'tab-page-preview-markdown page-typography';
  const title = document.createElement('h1');
  title.className = 'tab-page-preview-markdown-title page-title-typography';
  title.textContent = page.title || 'Untitled';
  const body = document.createElement('div');
  body.className = 'tab-page-preview-markdown-body';
  body.innerHTML = markdownPageModel.renderMarkdown(page.markdownBody || '');
  documentPreview.append(title, body);
  preview.append(documentPreview);
  preview.classList.add('is-content-ready');
}

function renderTextOnlyTabPagePreview(preview, page, message) {
  const placeholder = document.createElement('article');
  placeholder.className = 'tab-page-preview-placeholder page-typography';
  const title = document.createElement('h1');
  title.className = 'tab-page-preview-placeholder-title page-title-typography';
  title.textContent = page?.title || 'Untitled';
  const detail = document.createElement('p');
  detail.className = 'tab-page-preview-placeholder-detail';
  detail.textContent = message;
  placeholder.append(title, detail);
  preview.append(placeholder);
  preview.classList.add('is-content-ready');
}

function renderHnTextTabPagePreview(preview, tab, page) {
  const liveSnapshot = hnPageDocumentSessionRegistry?.get?.(page?.id)?.currentSnapshot?.();
  const textualContent = typeof liveSnapshot?.source === 'string'
    ? liveSnapshot.source
    : hnTextSourceFromEnvelope(page?.cneText);
  renderTextOnlyTabPagePreview(
    preview,
    page,
    textualContent.trim() || 'HN Text'
  );
}

const tabPagePreviewRenderers = new Map([
  ['canvas', renderImageTabPagePreview],
  ['markdown', renderMarkdownTabPagePreview],
  ['cne-text', renderHnTextTabPagePreview]
]);

function tabPagePreviewRenderer(page) {
  const renderer = tabPagePreviewRenderers.get(pageTypesModel.pageTypeRendererId(page?.type));
  if (!renderer) throw new Error(`Unsupported Page Type: ${page?.type ?? 'invalid'}.`);
  return renderer;
}

function sharedPagePreviewViewportSize(runtime) {
  return {
    width: Math.max(1, workspacePaneRoot?.clientWidth || runtime?.dom.canvasArea.clientWidth),
    height: Math.max(1, workspacePaneRoot?.clientHeight || runtime?.dom.canvasArea.clientHeight)
  };
}

function renderTabPagePreview(runtime, tab, pageTitle) {
  const previewViewport = sharedPagePreviewViewportSize(runtime);
  const viewportWidth = previewViewport.width;
  const viewportHeight = previewViewport.height;
  const size = tabPagePreviewModel.calculatePreviewSize({
    viewportWidth,
    viewportHeight,
    windowWidth: globalThis.innerWidth,
    windowHeight: globalThis.innerHeight
  });
  const preview = document.createElement('div');
  preview.className = 'tab-page-preview is-page-mode';
  preview.dataset.tabId = tab.id;
  preview.setAttribute('aria-hidden', 'true');
  preview.style.width = `${size.width}px`;
  preview.style.height = `${size.height}px`;
  const surface = document.createElement('div');
  surface.className = 'tab-page-preview-surface';
  const tabBody = document.createElement('div');
  tabBody.className = 'tab-page-preview-tab-body';
  const title = document.createElement('span');
  title.className = 'drag-preview-title page-title-typography';
  title.textContent = pageTitle;
  tabBody.append(title);
  const tabConnector = document.createElement('span');
  tabConnector.className = 'tab-page-preview-tab-connector';
  const leftShoulder = document.createElement('span');
  leftShoulder.className = 'tab-page-preview-shoulder is-left';
  const rightShoulder = document.createElement('span');
  rightShoulder.className = 'tab-page-preview-shoulder is-right';
  const divider = document.createElement('span');
  divider.className = 'tab-page-preview-divider';
  preview.append(
    surface,
    tabBody,
    tabConnector,
    leftShoulder,
    rightShoulder,
    divider
  );
  const geometry = { ...size, viewportWidth, viewportHeight };
  if (!tab.currentPageId) return preview;
  const canonicalPage = canonicalPages.get(tab.currentPageId);
  if (canonicalPage) {
    tabPagePreviewRenderer(canonicalPage)(surface, tab, canonicalPage, geometry);
    return preview;
  }
  loadTabPreviewPage(tab).then((page) => {
    if (!page || !preview.isConnected) return;
    return tabPagePreviewRenderer(page)(surface, tab, page, geometry);
  }).catch(() => {
    // A stale or unavailable Page leaves a safe blank preview surface.
  });
  return preview;
}

function tabPagePreviewSurface(preview) {
  return preview?.querySelector('.tab-page-preview-surface') || null;
}

function tabPagePreviewTabBody(preview) {
  return preview?.querySelector('.tab-page-preview-tab-body') || null;
}

function tabPagePreviewSize(preview) {
  return {
    width: Math.max(1, preview?.offsetWidth || Number.parseFloat(preview?.style.width) || 1),
    height: Math.max(1, preview?.offsetHeight || Number.parseFloat(preview?.style.height) || 1)
  };
}

function prepareSharedPagePreview(state, tab) {
  if (!state || state.previewElement) return state?.previewElement || null;
  const runtime = runtimeForPane(state.source?.paneId) || activePaneRuntime();
  const preview = renderTabPagePreview(runtime, tab, state.pageTitle);
  preview.dataset.active = String(Boolean(state.previewTabActive));
  preview.hidden = true;
  preview.classList.add('is-preparing');
  document.body.append(preview);
  const size = tabPagePreviewSize(preview);
  state.previewElement = preview;
  state.previewSurface = tabPagePreviewSurface(preview);
  state.previewTabBody = tabPagePreviewTabBody(preview);
  state.previewPointerOffset = {
    x: size.width * state.grabRatioX,
    y: size.height * state.grabRatioY
  };
  state.pagePreviewSize = size;
  return preview;
}

function prepareSharedPageDragPreview(state) {
  return prepareSharedPagePreview(state, {
    id: state.source.tabId || `sidebar-page-${state.pageId}`,
    currentPageId: state.pageId
  });
}

function beginSharedPageDrag({ event, pageId, source, state = {} }) {
  const originRect = source?.originRect;
  if (!event || pageId === undefined || !originRect || !source?.type) return null;
  const dragState = Object.assign(state, {
    source,
    pageId,
    pageTitle: canonicalDragPageTitle(pageId),
    mode: 'page',
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    lastClientX: event.clientX,
    lastClientY: event.clientY,
    grabRatioX: Math.min(1, Math.max(0, (event.clientX - originRect.left) / originRect.width)),
    grabRatioY: Math.min(1, Math.max(0, (event.clientY - originRect.top) / originRect.height)),
    previewElement: null,
    previewSurface: null,
    previewTabBody: null,
    previewPointerOffset: null,
    previewMorphTimer: 0,
    previewModeTimer: 0,
    previewModeToken: 0,
    previewReturnTransitionEnd: null,
    previewReturnTransitionCancel: null,
    previewReturnSurfaceTransitionEnd: null,
    previewReturnSurfaceTransitionCancel: null,
    previewReturnTabBodyTransitionEnd: null,
    previewReturnTabBodyTransitionCancel: null,
    previewReturnFallbackTimer: 0,
    previewReturnShellComplete: false,
    previewReturnSurfaceComplete: false,
    previewReturnTabBodyComplete: false,
    previewReturnComplete: false,
    previewReturnReconnectStarted: false,
    detachDampedY: 0,
    cleanupComplete: false
  });
  if (dragState.preparePreview !== false) prepareSharedPageDragPreview(dragState);
  return dragState;
}

function destroySharedPagePreview(state) {
  if (!state) return;
  clearActiveTabDampingPresentation(state);
  clearSharedPagePreviewReturnCompletion(state);
  clearTabPreviewMorph(state);
  if (state.previewModeTimer) window.clearTimeout(state.previewModeTimer);
  state.previewModeTimer = 0;
  state.previewElement?.remove();
  state.previewElement = null;
  state.previewSurface = null;
  state.previewTabBody = null;
}

function positionSharedPagePreview(state) {
  if (!state?.previewElement || !state.previewPointerOffset) return;
  const left = state.lastClientX - state.previewPointerOffset.x;
  const top = state.lastClientY - state.previewPointerOffset.y;
  state.previewLeft = left;
  state.previewTop = top;
  state.previewElement.style.transform = `translate3d(${left}px, ${top}px, 0)`;
}

function unfoldSharedPagePreviewFromRect(state, sourceRect) {
  const preview = state?.previewElement;
  const surface = state?.previewSurface || tabPagePreviewSurface(preview);
  if (!preview || !sourceRect) return false;
  const size = tabPagePreviewSize(preview);
  const gripX = state.previewPointerOffset.x;
  const gripY = state.previewPointerOffset.y;
  const finalLeft = state.lastClientX - gripX;
  const finalTop = state.lastClientY - gripY;
  const scaleX = sourceRect.width / size.width;
  const scaleY = sourceRect.height / size.height;
  const startOffsetX = sourceRect.left - (finalLeft + gripX * (1 - scaleX));
  const startOffsetY = sourceRect.top - (finalTop + gripY * (1 - scaleY));
  const expectedModeToken = state.previewModeToken;
  preview.style.transform = `translate3d(${finalLeft}px, ${finalTop}px, 0)`;
  preview.style.setProperty('--preview-shadow-opacity', '0');
  if (surface) {
    surface.style.transformOrigin = `${state.grabRatioX * 100}% ${state.grabRatioY * 100}%`;
    surface.style.transform = `translate3d(${startOffsetX}px, ${startOffsetY}px, 0) scale3d(${scaleX}, ${scaleY}, 1)`;
  }
  preview.hidden = false;
  preview.classList.remove('is-preparing', 'is-returning');
  preview.getBoundingClientRect();
  preview.classList.add('is-unfolding');
  preview.style.setProperty('--preview-shadow-opacity', '1');
  if (surface) surface.style.transform = 'translate3d(0, 0, 0) scale3d(1, 1, 1)';
  state.previewLeft = finalLeft;
  state.previewTop = finalTop;
  state.previewMorphTimer = window.setTimeout(() => {
    state.previewMorphTimer = 0;
    if (state.mode !== 'page' || state.previewModeToken !== expectedModeToken) return;
    preview?.classList.remove('is-unfolding');
  }, TAB_PREVIEW_MORPH_DURATION);
  return true;
}

function showSharedPagePreviewInTabMode(state, tabRect) {
  const preview = state?.previewElement;
  if (!preview || !tabRect) return false;
  clearTabPreviewMorph(state);
  if (state.previewModeTimer) window.clearTimeout(state.previewModeTimer);
  const title = preview.querySelector('.drag-preview-title');
  if (title) title.textContent = state.pageTitle;
  preview.classList.remove('is-preparing', 'is-returning');
  preview.style.width = `${Math.max(1, tabRect.width)}px`;
  preview.style.height = `${Math.max(1, tabRect.height)}px`;
  preview.style.setProperty('--drag-tab-height', `${Math.max(1, tabRect.height)}px`);
  preview.style.setProperty('--preview-shadow-opacity', '0');
  clearActiveTabDampingPresentation(state);
  preview.style.transform = `translate3d(${tabRect.left}px, ${tabRect.top}px, 0)`;
  state.mode = 'tab';
  const expectedModeToken = ++state.previewModeToken;
  preview.classList.remove('is-page-mode');
  preview.classList.add('is-tab-mode', 'is-mode-changing');
  preview.hidden = false;
  state.previewLeft = tabRect.left;
  state.previewTop = tabRect.top;
  state.previewModeTimer = window.setTimeout(() => {
    state.previewModeTimer = 0;
    if (state.mode !== 'tab' || state.previewModeToken !== expectedModeToken) return;
    preview?.classList.remove('is-mode-changing');
  }, TAB_PREVIEW_MORPH_DURATION);
  return true;
}

function showSharedPagePreviewInPageMode(state, sourceRect) {
  const preview = state?.previewElement;
  if (!preview || !state.pagePreviewSize) return false;
  if (state.previewModeTimer) window.clearTimeout(state.previewModeTimer);
  state.previewModeTimer = 0;
  state.mode = 'page';
  state.previewModeToken += 1;
  clearActiveTabDampingPresentation(state);
  preview.classList.remove('is-tab-mode', 'is-mode-changing');
  preview.classList.add('is-page-mode');
  preview.style.width = `${state.pagePreviewSize.width}px`;
  preview.style.height = `${state.pagePreviewSize.height}px`;
  return unfoldSharedPagePreviewFromRect(state, sourceRect);
}

function positionSharedTabModePreview(state) {
  if (!state?.previewElement || !state.element?.isConnected) return;
  const rect = state.element.getBoundingClientRect();
  state.previewElement.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
  state.previewLeft = rect.left;
  state.previewTop = rect.top;
}

function clearActiveTabDampingPresentation(state) {
  state?.previewElement?.classList.remove('has-active-tab-body-damping');
  state?.previewElement?.style.removeProperty('--tab-damped-y');
}

function updateActiveTabDampingPresentation(state, peelY = 0) {
  const dampedY = Math.max(0, Number(peelY) || 0);
  const activeDamping = Boolean(
    state?.previewTabActive
    && state.phase === 'reordering'
    && state.mode === 'tab'
    && dampedY > 0.01
  );
  const tabBody = state?.previewTabBody || tabPagePreviewTabBody(state?.previewElement);
  if (!activeDamping || !tabBody) {
    clearActiveTabDampingPresentation(state);
    return;
  }
  state.previewElement.classList.add('has-active-tab-body-damping');
  state.previewElement.style.setProperty('--tab-damped-y', `${dampedY}px`);
}

function animateSharedPagePreviewReturn(state, target, { isCurrent, onFinish } = {}) {
  const preview = state?.previewElement;
  if (!preview || !target || typeof onFinish !== 'function') {
    onFinish?.();
    return false;
  }
  const returningFromPageMode = !preview.classList.contains('is-tab-mode');
  const activeTabReconnectY = returningFromPageMode
    && state.source?.type === 'tab'
    && state.previewTabActive
    ? Math.max(0, Number(state.detachDampedY) || 0)
    : 0;
  const flightTarget = activeTabReconnectY > 0
    ? { ...target, top: target.top + activeTabReconnectY }
    : target;
  if (returningFromPageMode) positionSharedPagePreview(state);
  freezeTabPagePreviewSurface(state);
  const surface = state?.previewSurface || tabPagePreviewSurface(preview);
  const tabBody = state?.previewTabBody || tabPagePreviewTabBody(preview);
  clearSharedPagePreviewReturnCompletion(state);
  if (state.previewModeTimer) window.clearTimeout(state.previewModeTimer);
  state.previewModeTimer = 0;
  preview.classList.remove('is-mode-changing');
  state.previewReturnComplete = false;
  state.previewReturnReconnectStarted = false;
  state.previewReturnShellComplete = false;
  state.previewReturnSurfaceComplete = !surface || preview.classList.contains('is-tab-mode');
  const tabBodyDampedY = Number.parseFloat(
    preview.style.getPropertyValue('--tab-damped-y') || '0'
  );
  state.previewReturnTabBodyComplete = !(
    state.previewTabActive
    && preview.classList.contains('is-tab-mode')
    && Number.isFinite(tabBodyDampedY)
    && tabBodyDampedY > 0.01
  );
  const completeIfReady = () => {
    if (!state.previewReturnShellComplete
      || !state.previewReturnSurfaceComplete
      || !state.previewReturnTabBodyComplete) return;
    if (state.previewReturnComplete) return;
    if (activeTabReconnectY > 0) {
      if (state.previewReturnReconnectStarted) return;
      state.previewReturnReconnectStarted = true;
      beginActiveTabReturnReconnect(state, target, activeTabReconnectY, {
        isCurrent,
        onFinish
      });
      return;
    }
    state.previewReturnComplete = true;
    onFinish();
  };
  state.previewReturnTransitionEnd = (event) => {
    if (event.target !== preview || event.propertyName !== 'transform') return;
    state.previewReturnShellComplete = true;
    completeIfReady();
  };
  state.previewReturnTransitionCancel = (event) => {
    if (event.target !== preview || event.propertyName !== 'transform') return;
    state.previewReturnShellComplete = true;
    state.previewReturnSurfaceComplete = true;
    state.previewReturnTabBodyComplete = true;
    completeIfReady();
  };
  preview.addEventListener('transitionend', state.previewReturnTransitionEnd);
  preview.addEventListener('transitioncancel', state.previewReturnTransitionCancel);
  if (surface && !state.previewReturnSurfaceComplete) {
    state.previewReturnSurfaceTransitionEnd = (event) => {
      if (event.target !== surface || event.propertyName !== 'transform') return;
      state.previewReturnSurfaceComplete = true;
      completeIfReady();
    };
    state.previewReturnSurfaceTransitionCancel = (event) => {
      if (event.target !== surface || event.propertyName !== 'transform') return;
      state.previewReturnShellComplete = true;
      state.previewReturnSurfaceComplete = true;
      completeIfReady();
    };
    surface.addEventListener('transitionend', state.previewReturnSurfaceTransitionEnd);
    surface.addEventListener('transitioncancel', state.previewReturnSurfaceTransitionCancel);
  }
  if (tabBody && !state.previewReturnTabBodyComplete) {
    state.previewReturnTabBodyTransitionEnd = (event) => {
      if (event.target !== tabBody || event.propertyName !== 'transform') return;
      state.previewReturnTabBodyComplete = true;
      completeIfReady();
    };
    state.previewReturnTabBodyTransitionCancel = (event) => {
      if (event.target !== tabBody || event.propertyName !== 'transform') return;
      state.previewReturnShellComplete = true;
      state.previewReturnSurfaceComplete = true;
      state.previewReturnTabBodyComplete = true;
      completeIfReady();
    };
    tabBody.addEventListener('transitionend', state.previewReturnTabBodyTransitionEnd);
    tabBody.addEventListener('transitioncancel', state.previewReturnTabBodyTransitionCancel);
  }
  const size = tabPagePreviewSize(preview);
  preview.classList.remove('is-unfolding');
  preview.classList.add('is-returning');
  preview.style.setProperty('--preview-shadow-opacity', '0');
  preview.getBoundingClientRect();
  window.requestAnimationFrame(() => {
    if ((typeof isCurrent === 'function' && !isCurrent()) || !preview.isConnected) return;
    preview.style.transform = `translate3d(${flightTarget.left}px, ${flightTarget.top}px, 0)`;
    if (surface) {
      surface.style.transformOrigin = '0 0';
      surface.style.transform = `translate3d(0, 0, 0) scale3d(${flightTarget.width / size.width}, ${flightTarget.height / size.height}, 1)`;
    }
    if (tabBody && !state.previewReturnTabBodyComplete) {
      preview.style.setProperty('--tab-damped-y', '0px');
    }
    state.previewReturnFallbackTimer = window.setTimeout(() => {
      state.previewReturnShellComplete = true;
      state.previewReturnSurfaceComplete = true;
      state.previewReturnTabBodyComplete = true;
      completeIfReady();
    }, TAB_DETACH_RETURN_DURATION);
  });
  return true;
}

function beginActiveTabReturnReconnect(state, target, dampedY, { isCurrent, onFinish }) {
  const preview = state?.previewElement;
  const tabBody = state?.previewTabBody || tabPagePreviewTabBody(preview);
  if (!preview || !tabBody || !preview.isConnected) {
    onFinish();
    return false;
  }
  clearSharedPagePreviewReturnCompletion(state);
  if ((typeof isCurrent === 'function' && !isCurrent()) || !preview.isConnected) return false;
  if (state.previewModeTimer) window.clearTimeout(state.previewModeTimer);
  state.previewModeTimer = 0;
  state.mode = 'tab';
  state.previewModeToken += 1;
  preview.classList.remove('is-page-mode', 'is-unfolding', 'is-mode-changing');
  preview.classList.add(
    'is-tab-mode',
    'is-returning',
    'is-tab-reconnect',
    'has-active-tab-body-damping'
  );
  preview.style.width = `${Math.max(1, target.width)}px`;
  preview.style.height = `${Math.max(1, target.height)}px`;
  preview.style.setProperty('--drag-tab-height', `${Math.max(1, target.height)}px`);
  preview.style.setProperty('--preview-shadow-opacity', '0');
  preview.style.setProperty('--tab-damped-y', `${dampedY}px`);
  preview.style.transform = `translate3d(${target.left}px, ${target.top}px, 0)`;
  state.previewLeft = target.left;
  state.previewTop = target.top;
  state.previewReturnComplete = false;
  state.previewReturnShellComplete = true;
  state.previewReturnSurfaceComplete = true;
  state.previewReturnTabBodyComplete = false;
  const complete = () => {
    if (state.previewReturnComplete || !state.previewReturnTabBodyComplete) return;
    state.previewReturnComplete = true;
    onFinish();
  };
  state.previewReturnTabBodyTransitionEnd = (event) => {
    if (event.target !== tabBody || event.propertyName !== 'transform') return;
    state.previewReturnTabBodyComplete = true;
    complete();
  };
  state.previewReturnTabBodyTransitionCancel = (event) => {
    if (event.target !== tabBody || event.propertyName !== 'transform') return;
    state.previewReturnTabBodyComplete = true;
    complete();
  };
  tabBody.addEventListener('transitionend', state.previewReturnTabBodyTransitionEnd);
  tabBody.addEventListener('transitioncancel', state.previewReturnTabBodyTransitionCancel);
  preview.getBoundingClientRect();
  window.requestAnimationFrame(() => {
    if ((typeof isCurrent === 'function' && !isCurrent()) || !preview.isConnected) return;
    preview.style.setProperty('--tab-damped-y', '0px');
    state.previewReturnFallbackTimer = window.setTimeout(() => {
      state.previewReturnTabBodyComplete = true;
      complete();
    }, TAB_DETACH_RETURN_DURATION);
  });
  return true;
}

function suppressNextSidebarPageClick(pageId, delay = 700) {
  if (sidebarPageDragSuppressedClickTimer) window.clearTimeout(sidebarPageDragSuppressedClickTimer);
  sidebarPageDragSuppressedClickId = pageId;
  sidebarPageDragSuppressedClickTimer = window.setTimeout(() => {
    sidebarPageDragSuppressedClickId = null;
    sidebarPageDragSuppressedClickTimer = 0;
  }, delay);
}

function suppressSharedPageDragSourceClick(state, delay = 700) {
  if (state?.source?.type === 'sidebar-page') {
    suppressNextSidebarPageClick(state.pageId, delay);
    return;
  }
  suppressNextTabClick(state?.tabId, delay);
}

function consumeSidebarPageDragClick(pageId) {
  if (sidebarPageDragSuppressedClickId !== pageId) return false;
  if (sidebarPageDragSuppressedClickTimer) window.clearTimeout(sidebarPageDragSuppressedClickTimer);
  sidebarPageDragSuppressedClickId = null;
  sidebarPageDragSuppressedClickTimer = 0;
  return true;
}

function removeSidebarPageDragPointerListeners() {
  window.removeEventListener('pointermove', handleSidebarPageDragPointerMove);
  window.removeEventListener('pointerup', handleSidebarPageDragPointerUp);
  window.removeEventListener('pointercancel', handleSidebarPageDragPointerCancel);
}

function releaseSidebarPageDragPointer(state) {
  if (!state?.sourceRow?.hasPointerCapture?.(state.pointerId)) return;
  try {
    state.sourceRow.releasePointerCapture(state.pointerId);
  } catch (_error) {
    // The row may have been replaced by a navigation rerender.
  }
}

function clearSidebarPageNavigationPresentation(state) {
  if (typeof clearSidebarPageNavigationMembershipTarget === 'function') {
    clearSidebarPageNavigationMembershipTarget();
  }
  state?.sourceRow?.classList.remove('is-sidebar-page-navigation-drag-source');
  document.body.classList.remove('is-sidebar-page-navigation-dragging');
}

function updateSidebarPageNavigationPresentation(state) {
  if (!state || state.phase !== 'navigation-extracted') return null;
  if (typeof updateSidebarPageNavigationDragPointer === 'function') {
    updateSidebarPageNavigationDragPointer(
      state.navigationDragDescriptor,
      state.lastClientX,
      state.lastClientY
    );
  }
  if (state.navigationDragDescriptor?.explicitMultiSelection) {
    const strip = hitTestTabStrip(state.lastClientX, state.lastClientY);
    const batchTabTarget = strip
      ? pagePreviewTabDropTarget(strip, state.lastClientX)
      : null;
    if (batchTabTarget) {
      clearSidebarPageNavigationMembershipTarget?.();
      renderSidebarPageDropIndicator(batchTabTarget);
      return batchTabTarget;
    }
    clearSidebarPageDropIndicators();
  }
  return typeof updateSidebarPageNavigationMembershipTarget === 'function'
    ? updateSidebarPageNavigationMembershipTarget(
      state.navigationDragDescriptor,
      state.lastClientX,
      state.lastClientY
    )
    : null;
}

function releaseSidebarPageDragOwnership(state) {
  if (!state || state.source?.type !== 'sidebar-page') return;
  if (sidebarPageDragFrame) window.cancelAnimationFrame(sidebarPageDragFrame);
  sidebarPageDragFrame = 0;
  removeSidebarPageDragPointerListeners();
  clearSidebarPageNavigationPresentation(state);
  clearSidebarPageDropIndicators();
  state.sourceRow?.classList.remove('is-sidebar-page-drag-source');
  document.body.classList.remove('is-sidebar-page-dragging');
  if (sidebarPageDragState === state) sidebarPageDragState = null;
  releaseSidebarPageDragPointer(state);
}

function clearSidebarPageDropIndicators() {
  for (const strip of document.querySelectorAll('.is-page-preview-tab-drop-target')) {
    strip.classList.remove('is-page-preview-tab-drop-target');
    strip.style.removeProperty('--page-preview-tab-insert-x');
  }
  activePaneRuntime().dom.canvasArea?.classList.remove('is-sidebar-page-empty-tab-target');
  document.querySelector('.sidebar-page-pane-drop-indicator')?.remove();
  document.querySelector('.workspace-pane-edge-drop-indicator')?.remove();
}

function pagePreviewTabDropTarget(stripTarget, clientX) {
  const tabElements = [...stripTarget.list.querySelectorAll('.viewer-tab')];
  const rects = tabElements.map((element) => element.getBoundingClientRect());
  const insertionIndex = tabStripLayoutModel.insertionIndexAtPoint(rects, clientX);
  const stripRect = stripTarget.element.getBoundingClientRect();
  let indicatorX;
  if (!rects.length) indicatorX = Math.max(0, clientX - stripRect.left);
  else if (insertionIndex >= rects.length) indicatorX = rects.at(-1).right - stripRect.left;
  else indicatorX = rects[insertionIndex].left - stripRect.left;
  return { kind: 'tab-strip', ...stripTarget, insertionIndex, indicatorX };
}

function workspacePaneDropRegions() {
  const rootRect = workspacePaneRoot?.getBoundingClientRect();
  const tabAreaRect = topTabArea?.getBoundingClientRect();
  if (!rootRect || !tabAreaRect) return [];
  return workspace.state.panes.map((pane, index) => {
    const regionRect = pane.element?.getBoundingClientRect();
    if (!regionRect) return null;
    return {
      pane,
      paneId: pane.id,
      paneIndex: index,
      bounds: {
        left: regionRect.left,
        right: regionRect.right,
        top: tabAreaRect.top,
        bottom: rootRect.bottom,
        width: regionRect.width,
        height: rootRect.bottom - tabAreaRect.top
      }
    };
  }).filter(Boolean);
}

function paneEdgeDropTarget(clientX, clientY) {
  for (const region of workspacePaneDropRegions()) {
    const { pane, paneIndex, bounds } = region;
    if (clientX < bounds.left || clientX > bounds.right
      || clientY < bounds.top || clientY > bounds.bottom) continue;
    let direction = null;
    if (pane.mode === 'collapsed') {
      direction = clientX < bounds.left + bounds.width / 2 ? 'left' : 'right';
    } else {
      const edgeWidth = Math.min(72, Math.max(28, bounds.width * 0.14));
      const leftDistance = clientX - bounds.left;
      const rightDistance = bounds.right - clientX;
      if (Math.min(leftDistance, rightDistance) > edgeWidth) continue;
      direction = leftDistance <= rightDistance ? 'left' : 'right';
    }
    return {
      kind: 'pane-edge',
      paneId: pane.id,
      paneIndex,
      direction,
      insertionIndex: direction === 'left' ? paneIndex : paneIndex + 1,
      bounds
    };
  }
  return null;
}

function sharedPagePreviewCanTargetPane(state) {
  return state?.mode === 'page'
    && (state.phase === 'dragging'
      || state.phase === 'spatial-preview'
      || state.phase === 'detached-preview');
}

function validSharedPreviewTabTarget(state, clientX, clientY) {
  const strip = tabReorderState === state
    ? hitTestTabStripInterior(clientX, clientY)
    : hitTestTabStrip(clientX, clientY);
  if (!strip) return null;
  if (tabReorderState === state && strip.stripId !== state.sourceStripId) return null;
  return pagePreviewTabDropTarget(strip, clientX);
}

function hitTestSharedPageDropTarget(state, clientX, clientY, { includeEmptyTab = false } = {}) {
  const tabTarget = validSharedPreviewTabTarget(state, clientX, clientY);
  if (tabTarget) return tabTarget;
  if (sharedPagePreviewCanTargetPane(state)) {
    const paneTarget = paneEdgeDropTarget(clientX, clientY);
    if (paneTarget) return paneTarget;
  }
  if (!includeEmptyTab) return null;
  const strip = hitTestTabStrip(clientX, clientY);
  if (strip) return pagePreviewTabDropTarget(strip, clientX);
  const runtime = activePaneRuntime();
  const active = runtime ? activeTab(runtime) : null;
  const paneBounds = runtime?.dom.canvasArea?.getBoundingClientRect();
  if (active?.currentPageId === null && paneBounds
    && clientX >= paneBounds.left && clientX <= paneBounds.right
    && clientY >= paneBounds.top && clientY <= paneBounds.bottom) {
    return { kind: 'empty-tab', paneId: getActivePane()?.id, bounds: paneBounds };
  }
  return null;
}

function hitTestSidebarPageDropTarget(clientX, clientY, state = sidebarPageDragState) {
  return hitTestSharedPageDropTarget(state, clientX, clientY, { includeEmptyTab: true });
}

function renderSidebarPageDropIndicator(target) {
  clearSidebarPageDropIndicators();
  if (!target) return;
  if (target.kind === 'tab-strip') {
    target.element.classList.add('is-page-preview-tab-drop-target');
    target.element.style.setProperty('--page-preview-tab-insert-x', `${target.indicatorX}px`);
    return;
  }
  if (target.kind === 'empty-tab') {
    activePaneRuntime().dom.canvasArea.classList.add('is-sidebar-page-empty-tab-target');
    return;
  }
  if (target.kind === 'pane-edge') {
    const rootRect = workspacePaneRoot?.getBoundingClientRect();
    if (!rootRect) return;
    const width = Math.min(
      getWorkspacePane(target.paneId)?.minWidth || workspacePanesModel.DEFAULT_PANE_MIN_WIDTH,
      rootRect.width
    );
    const boundary = target.direction === 'left'
      ? target.bounds.left
      : target.bounds.right;
    const proposedLeft = target.direction === 'left' ? boundary - width : boundary;
    const left = Math.max(rootRect.left, Math.min(proposedLeft, rootRect.right - width));
    const indicator = document.createElement('div');
    indicator.className = 'workspace-pane-edge-drop-indicator';
    indicator.dataset.direction = target.direction;
    indicator.dataset.paneId = target.paneId;
    indicator.setAttribute('aria-hidden', 'true');
    Object.assign(indicator.style, {
      left: `${left}px`,
      top: `${target.bounds.top}px`,
      width: `${width}px`,
      height: `${Math.max(0, rootRect.bottom - target.bounds.top)}px`
    });
    document.body.append(indicator);
  }
}

function updateSharedPageDropTarget(state, { includeEmptyTab = false } = {}) {
  const target = hitTestSharedPageDropTarget(
    state,
    state.lastClientX,
    state.lastClientY,
    { includeEmptyTab }
  );
  const signature = target
    ? [target.kind, target.paneId, target.direction, target.insertionIndex].join(':')
    : '';
  if (signature === state.dropTargetSignature) return;
  state.dropTarget = target;
  state.dropTargetSignature = signature;
  renderSidebarPageDropIndicator(target);
}

function updateSidebarPageDropTarget(state) {
  updateSharedPageDropTarget(state, { includeEmptyTab: true });
}

function createTabPreviewContractTarget({ id, active = false, rect }) {
  const element = document.createElement('div');
  element.className = 'viewer-tab is-tab-reorder-dragging is-tab-preview-contract-target';
  element.dataset.tabId = id;
  element.dataset.active = String(Boolean(active));
  element.setAttribute('aria-hidden', 'true');
  Object.assign(element.style, {
    position: 'fixed',
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    flex: 'none',
    width: `${rect.width}px`,
    minWidth: `${rect.width}px`,
    maxWidth: `${rect.width}px`,
    height: `${rect.height}px`,
    transform: 'translate3d(0, 0, 0)'
  });
  document.body.append(element);
  return element;
}

function handoffSidebarPageDragToTabReorder(state, { attachPointerListeners = true } = {}) {
  if (!state || state.source?.type !== 'sidebar-page'
    || sidebarPageDragState !== state || tabReorderState) return false;
  releaseSidebarPageDragOwnership(state);
  state.phase = 'reordering';
  state.gestureIntent = 'horizontal-reorder';
  state.startClientX = state.lastClientX;
  state.startClientY = state.lastClientY;
  state.peelY = 0;
  state.peelTargetY = 0;
  state.previewReentryArmed = false;
  state.detachedAtClientY = null;
  state.returnCleanupComplete = false;
  state.cleanupComplete = false;
  tabReorderState = state;
  if (attachPointerListeners) addTabReorderPointerListeners();
  state.element.addEventListener('lostpointercapture', handleTabReorderLostPointerCapture);
  try {
    state.element.setPointerCapture?.(state.pointerId);
  } catch (_error) {
    // Window listeners retain ownership when capture cannot move between elements.
  }
  return true;
}

function beginSidebarTabStripEntry(state, target, options = {}) {
  if (!state || !['dragging', 'spatial-preview'].includes(state.phase)
    || target?.ownerPaneId !== getActivePane()?.id
    || tabReorderState) return false;
  const list = target.list;
  const strip = target.element;
  if (!list?.isConnected || !strip?.isConnected) return false;
  const plus = strip.querySelector('.viewer-tab-add');
  if (plus) {
    plus.classList.remove('is-tab-reorder-displaced');
    plus.style.transform = '';
  }
  clearSidebarPageDropIndicators();
  clearTabReorderSettleAnimation();
  freezeTabPagePreviewSurface(state);
  const temporaryId = `shared-drag-slot-${state.pageId}`;
  if (tabStripLayoutFrame) window.cancelAnimationFrame(tabStripLayoutFrame);
  tabStripLayoutFrame = 0;
  const provisionalSizing = updateTabStripLayout({
    provisionalInactiveTabCount: 1,
    provisionalTabWillBeActive: true
  });
  const stationaryTabs = tabReorderSlots(list);
  const width = Math.max(
    tabStripLayoutModel.MINIMUM_INACTIVE_TAB_WIDTH,
    provisionalSizing?.provisionalTabWidth
      || tabStripLayoutModel.PREFERRED_TAB_WIDTH
  );
  const listRect = list.getBoundingClientRect();
  const pointerContentX = state.lastClientX - listRect.left + list.scrollLeft;
  const originIndex = tabStripLayoutModel.insertionIndexAtPoint(
    stationaryTabs,
    pointerContentX
  );
  const firstLeft = stationaryTabs[0]?.left || 0;
  const virtualLeft = originIndex < stationaryTabs.length
    ? stationaryTabs[originIndex].left
    : stationaryTabs.at(-1)?.right || firstLeft;
  const draggedSlot = {
    id: temporaryId,
    left: virtualLeft,
    right: virtualLeft + width,
    width,
    element: null
  };
  const stripRect = strip.getBoundingClientRect();
  const contractTarget = createTabPreviewContractTarget({
    id: temporaryId,
    active: state.previewTabActive,
    rect: {
      left: listRect.left - list.scrollLeft + draggedSlot.left,
      top: stripRect.top,
      width,
      height: stripRect.height
    }
  });
  draggedSlot.element = contractTarget;
  const slots = [...stationaryTabs];
  slots.splice(originIndex, 0, draggedSlot);
  state.element = contractTarget;
  state.tabContractElement = contractTarget;
  state.list = list;
  state.strip = strip;
  state.tabId = temporaryId;
  state.draggedTabId = temporaryId;
  state.commitMode = 'create-new-tab';
  state.source.commitMode = 'create-new-tab';
  state.sourceStripId = target.stripId;
  state.sourceIndex = originIndex;
  state.sourceActiveTabId = activeTab(activePaneRuntime())?.id || null;
  state.currentTargetStripId = target.stripId;
  state.originalTabOrder = slots.map((slot) => slot.id);
  state.slots = slots;
  state.draggedSlot = draggedSlot;
  state.originIndex = originIndex;
  state.provisionalIndex = originIndex;
  state.stationaryTabs = stationaryTabs;
  state.provisionalSlotRects = tabStripLayoutModel.provisionalSlotRects(
    slots,
    temporaryId,
    originIndex
  );
  state.grabOffsetX = draggedSlot.width * state.grabRatioX;
  state.originalTabRect = contractTarget.getBoundingClientRect();
  state.lastDraggedLeft = draggedSlot.left;
  state.needsInitialPlacement = true;
  state.dragX = 0;
  state.forceTabLayout = true;
  state.sidebarStripParticipationActive = true;
  strip.classList.add('is-tab-reordering');
  for (const slot of state.stationaryTabs) slot.element.classList.add('is-tab-reorder-displaced');
  updateTabReorderDividerOwnership(state);
  showSharedPagePreviewInTabMode(state, contractTarget.getBoundingClientRect());
  if (!handoffSidebarPageDragToTabReorder(state, options)) return false;
  applyTabReorderVisuals();
  return true;
}

function clearSidebarTabLayoutParticipation(state) {
  const strip = state?.strip;
  clearTabReorderDividerOverlays(state);
  strip?.classList.remove('is-tab-reordering');
  for (const slot of state?.slots || []) {
    if (slot.element === state.previewElement) continue;
    slot.element.classList.remove(
      'is-tab-reorder-dragging',
      'is-tab-reorder-displaced',
      'is-tab-preview-contract-target'
    );
    slot.element.style.transform = '';
    delete slot.element.dataset.reorderDivider;
  }
  const plus = strip?.querySelector('.viewer-tab-add');
  if (plus) {
    plus.classList.remove('is-tab-reorder-displaced');
    plus.style.transform = '';
  }
  state?.tabContractElement?.remove();
  state?.previewElement?.classList.remove('is-tab-mode');
  if (state) {
    state.tabContractElement = null;
    state.element = null;
    state.list = null;
    state.strip = null;
    state.slots = null;
    state.stationaryTabs = null;
    state.draggedSlot = null;
    state.currentTargetStripId = null;
  }
  updateTabStripLayout({ provisionalInactiveTabCount: 0 });
}

function clearSidebarPagePreviewCompletion(state) {
  clearSharedPagePreviewReturnCompletion(state);
  if (state?.previewMorphTimer) window.clearTimeout(state.previewMorphTimer);
  if (state) {
    state.previewMorphTimer = 0;
  }
}

function finishSidebarPageDrag(state) {
  if (!state || state.cleanupComplete) return false;
  state.cleanupComplete = true;
  if (state.phase === 'navigation-extracted' && state.navigationDragDescriptor
    && typeof restoreSidebarPageNavigationDrag === 'function') {
    restoreSidebarPageNavigationDrag(state.navigationDragDescriptor, 'gesture-finished');
  }
  state.navigationDragDescriptor = null;
  clearSidebarPagePreviewCompletion(state);
  if (sidebarPageDragFrame) window.cancelAnimationFrame(sidebarPageDragFrame);
  sidebarPageDragFrame = 0;
  removeSidebarPageDragPointerListeners();
  clearSidebarPageNavigationPresentation(state);
  clearSidebarPageDropIndicators();
  clearSidebarTabLayoutParticipation(state);
  destroySharedPagePreview(state);
  state.sourceRow?.classList.remove('is-sidebar-page-drag-source');
  document.body.classList.remove('is-sidebar-page-dragging');
  if (sidebarPageDragState === state) sidebarPageDragState = null;
  releaseSidebarPageDragPointer(state);
  return true;
}

function resolveSharedPageDragReturnTarget(state) {
  if (state.source.type === 'tab') return liveOriginalTabRect(state);
  const sidebar = document.querySelector('.left-sidebar-scroll-region')?.getBoundingClientRect();
  const liveSource = state.source.element?.isConnected
    ? state.source.element.getBoundingClientRect()
    : state.source.originRect;
  return sidebarPageDragModel.bestReturnRect(liveSource, sidebar);
}

function beginSidebarPageDragReturn(state) {
  if (!state || state.phase === 'returning') return;
  if (state.phase === 'navigation-extracted') {
    const descriptor = state.navigationDragDescriptor;
    releaseSidebarPageDragOwnership(state);
    if (typeof restoreSidebarPageNavigationDrag === 'function') {
      restoreSidebarPageNavigationDrag(descriptor, 'navigation-cancel');
    }
    return;
  }
  if (state.phase === 'pressing' || state.phase === 'undecided-drag'
    || !state.previewElement) {
    finishSidebarPageDrag(state);
    return;
  }
  state.phase = 'returning';
  if (sidebarPageDragFrame) window.cancelAnimationFrame(sidebarPageDragFrame);
  sidebarPageDragFrame = 0;
  removeSidebarPageDragPointerListeners();
  clearSidebarPageDropIndicators();
  releaseSidebarPageDragPointer(state);
  const target = resolveSharedPageDragReturnTarget(state);
  animateSharedPagePreviewReturn(state, target, {
    isCurrent: () => sidebarPageDragState === state,
    onFinish: () => finishSidebarPageDrag(state)
  });
}

function applySidebarPageDragVisuals() {
  sidebarPageDragFrame = 0;
  const state = sidebarPageDragState;
  if (!state) return;
  if (state.phase === 'navigation-extracted') {
    updateSidebarPageNavigationPresentation(state);
    return;
  }
  if (!state.previewElement?.isConnected) return;
  if (state.phase !== 'spatial-preview') return;
  positionSharedPagePreview(state);
  const stripTarget = hitTestTabStripInterior(state.lastClientX, state.lastClientY);
  if (stripTarget?.ownerPaneId === getActivePane()?.id) {
    const target = pagePreviewTabDropTarget(stripTarget, state.lastClientX);
    beginSidebarTabStripEntry(state, target);
    return;
  }
  updateSidebarPageDropTarget(state);
}

function scheduleSidebarPageDragVisuals() {
  if (sidebarPageDragFrame) return;
  sidebarPageDragFrame = window.requestAnimationFrame(applySidebarPageDragVisuals);
}

function startSidebarPageDrag(state) {
  if (!state || state.phase !== 'pressing' || activePaneRuntime().linkPickMode) return false;
  state.phase = 'undecided-drag';
  suppressNextSidebarPageClick(state.pageId);
  clearTabTitleTooltip();
  closePageContextMenu();
  state.navigationDragDescriptor = typeof navigationPageDragDescriptor === 'function'
    ? navigationPageDragDescriptor(state.pageId)
    : null;
  return true;
}

function startSidebarPageNavigationExtraction(state) {
  if (!state || state.phase !== 'undecided-drag') return false;
  state.navigationDragDescriptor = typeof beginSidebarPageNavigationDrag === 'function'
    ? beginSidebarPageNavigationDrag(
      state.navigationDragDescriptor,
      state.lastClientX,
      state.lastClientY,
      state.sourceRow
    )
    : state.navigationDragDescriptor;
  state.phase = 'navigation-extracted';
  state.sourceRow.classList.add('is-sidebar-page-navigation-drag-source');
  document.body.classList.add('is-sidebar-page-navigation-dragging');
  updateSidebarPageNavigationPresentation(state);
  return true;
}

function transitionSidebarPageDragToPreview(state) {
  if (!state || !['undecided-drag', 'navigation-extracted'].includes(state.phase)) return false;
  if (state.navigationDragDescriptor?.spatialPreviewEligible === false) return false;
  const navigationWasExtracted = state.phase === 'navigation-extracted';
  clearSidebarPageNavigationPresentation(state);
  if (navigationWasExtracted
    && typeof handoffSidebarPageNavigationDragToPreview === 'function') {
    handoffSidebarPageNavigationDragToPreview(state.navigationDragDescriptor);
  }
  state.navigationDragDescriptor = null;
  state.phase = 'spatial-preview';
  state.sourceRow.classList.add('is-sidebar-page-drag-source');
  document.body.classList.add('is-sidebar-page-dragging');
  if (!prepareSharedPageDragPreview(state)) {
    finishSidebarPageDrag(state);
    return false;
  }
  unfoldSharedPagePreviewFromRect(state, state.source.originRect);
  updateSidebarPageDropTarget(state);
  scheduleSidebarPageDragVisuals();
  return true;
}

async function commitSidebarPageDrop(state, target) {
  const { pageId, pageTitle: draggedPageTitle } = state;
  if (target.kind === 'empty-tab') {
    finishSidebarPageDrag(state);
    return populateActiveEmptyTab(activePaneRuntime(), pageId);
  }
  if (target.kind === 'tab-strip') {
    const existing = workspaceTabForPageInPane(target.ownerPaneId, pageId);
    if (existing) {
      finishSidebarPageDrag(state);
      return activateWorkspaceTab(existing);
    }
    if (target.ownerPaneId === getActivePane()?.id) {
      let previewCleaned = false;
      const finishAfterTabRender = () => {
        if (previewCleaned) return;
        previewCleaned = true;
        finishSidebarPageDrag(state);
      };
      const result = await openPageInNewTab(activePaneRuntime(), pageId, {
        insertionIndex: target.insertionIndex,
        pageTitle: draggedPageTitle,
        onTabRendered: finishAfterTabRender
      });
      finishAfterTabRender();
      return result;
    }
    finishSidebarPageDrag(state);
    return openPageInWorkspacePane(
      target.ownerPaneId,
      pageId,
      target.insertionIndex
    );
  }
  finishSidebarPageDrag(state);
  return false;
}

async function commitSidebarPageBatchTabDrop(state, target) {
  const descriptor = state?.navigationDragDescriptor;
  const pane = getWorkspacePane(target?.ownerPaneId);
  const pageIds = [...new Set(descriptor?.tabPageIds || [])]
    .filter((pageId) => pageIndex.pages.some((page) => page.id === pageId));
  if (!descriptor?.explicitMultiSelection || !pane || target?.kind !== 'tab-strip'
    || pageIds.length < 2) return false;

  finishSidebarPageDrag(state);
  setActiveWorkspacePane(pane.id, { refreshChrome: false });
  const runtime = runtimeForPane(pane);
  prepareInfoPanelsForRuntimeContextChange?.(runtime);
  saveActiveTabViewState(runtime);
  if (runtime.blockEditMode) cancelBlockEdits(runtime);
  if (runtime.pageEditMode) cancelPageEdits(runtime);
  if (runtime.highlightEditDraft) cancelHighlightEdits(runtime);
  closePageMetaModal();
  globalThis.clearMarkdownClipboardSelection?.({ clearBrowserSelection: true });

  const session = pane.session;
  const before = captureTabStripLayoutState();
  const placement = session.placePagesContiguously(pageIds, {
    insertionIndex: target.insertionIndex,
    activePageId: descriptor.primaryPageId
  });
  const primaryTab = placement.activeTab;
  if (!primaryTab) return false;
  renderTabStrip({ ensureActiveVisible: true, preserveDragState: true });
  if (before) {
    settleTabStripGeometry(
      new Map([...before.tabs].map(([tabId, snapshot]) => [tabId, snapshot.rect])),
      {
        oldPlusRect: before.plusRect,
        enteringTabIds: placement.createdTabIds,
        enteringFromRect: before.plusRect
      }
    );
  }
  const pageEntry = pageIndex.pages.find((page) => page.id === primaryTab.currentPageId);
  if (!pageEntry) return false;
  return loadPage(runtime, pageEntry, {
    historyMode: 'preserve',
    preferCanonical: true,
    saveCurrentView: false
  });
}

function finishSharedPageDragForPaneCommit(state) {
  clearSidebarPageDropIndicators();
  suppressSharedPageDragSourceClick(state, 1000);
  if (tabReorderState === state) {
    if (tabReorderFrame) window.cancelAnimationFrame(tabReorderFrame);
    tabReorderFrame = 0;
    removeTabReorderPointerListeners();
    releaseTabReorderPointer(state);
    tabReorderState = null;
    clearTabReorderTransforms(state);
    return;
  }
  finishSidebarPageDrag(state);
}

function returnSharedPageDragAfterFailedPaneCommit(state) {
  if (tabReorderState === state) beginTabReorderReturn(state);
  else beginSidebarPageDragReturn(state);
  return false;
}

async function refreshSourcePaneAfterTabTransfer(sourcePane, movedActiveTab) {
  if (!movedActiveTab || !sourcePane || getActivePane()?.id !== sourcePane.id) return;
  const runtime = runtimeForPane(sourcePane);
  const replacement = sourcePane.session.activeTab();
  renderTabStrip({ ensureActiveVisible: true, preserveLayoutTransition: true });
  if (!replacement?.currentPageId) {
    renderEmptyTab(runtime);
    return;
  }
  const pageEntry = pageIndex.pages.find((page) => page.id === replacement.currentPageId);
  if (!pageEntry) {
    renderEmptyTab(runtime, 'This Page is no longer available.');
    return;
  }
  await loadPage(runtime, pageEntry, {
    historyMode: 'preserve',
    preferCanonical: true,
    saveCurrentView: false
  });
}

async function commitSharedPageToPaneEdge(state, target) {
  if (!state || target?.kind !== 'pane-edge' || !sharedPagePreviewCanTargetPane(state)) {
    return false;
  }
  const destinationSession = sessionTabsModel.createTabSession();
  let sourcePane = null;
  let sourceSession = null;
  let transferredTab = null;
  let movedActiveTab = false;
  if (state.source.type === 'tab') {
    sourcePane = getWorkspacePane(state.source.paneId);
    sourceSession = sourcePane?.session;
    transferredTab = sourceSession?.tabById(state.source.tabId);
    if (!sourcePane || !transferredTab) {
      return returnSharedPageDragAfterFailedPaneCommit(state);
    }
    movedActiveTab = sourceSession.activeTab()?.id === transferredTab.id;
    if (getActivePane()?.id === sourcePane.id) {
      saveActiveTabViewState(runtimeForPane(sourcePane));
    }
  } else if (state.source.type === 'sidebar-page') {
    destinationSession.reset(state.pageId);
  } else return returnSharedPageDragAfterFailedPaneCommit(state);

  const pane = createAllocatedWorkspacePane(destinationSession, target.insertionIndex);
  if (!pane) return returnSharedPageDragAfterFailedPaneCommit(state);
  state.phase = 'committing';
  finishSharedPageDragForPaneCommit(state);

  if (transferredTab) {
    const extracted = sourceSession.extractTab(transferredTab.id);
    if (!extracted || destinationSession.insertTab(extracted) !== extracted) return false;
    const transferredPage = canonicalPages.get(extracted.currentPageId);
    if (pageIsHnText(transferredPage)) {
      getHnPageDocumentSession(transferredPage, runtimeForPane(pane), extracted);
    }
    scheduleHnSessionReferenceReconcile();
  }

  renderWorkspacePaneLayout();
  renderTabStrip({ ensureActiveVisible: true, preserveLayoutTransition: true });
  await refreshSourcePaneAfterTabTransfer(sourcePane, movedActiveTab);
  setActiveWorkspacePane(pane.id, { refreshChrome: false });
  const destinationRuntime = runtimeForPane(pane);
  renderTabStrip({ ensureActiveVisible: true, preserveLayoutTransition: true });
  const destinationTab = destinationSession.activeTab();
  if (!destinationTab?.currentPageId) {
    renderEmptyTab(destinationRuntime);
    refreshActivePaneWindowChrome(destinationRuntime);
    return true;
  }
  const pageEntry = pageIndex.pages.find((page) => page.id === destinationTab.currentPageId);
  if (!pageEntry) {
    renderEmptyTab(destinationRuntime, 'This Page is no longer available.');
    refreshActivePaneWindowChrome(destinationRuntime);
    return false;
  }
  return loadPage(destinationRuntime, pageEntry, {
    historyMode: 'preserve',
    preferCanonical: true,
    saveCurrentView: false
  });
}

function commitSharedPageDrag(state, target) {
  if (target?.kind === 'pane-edge') return commitSharedPageToPaneEdge(state, target);
  if (state.source.type === 'tab') return commitTabReorder(state);
  if (tabReorderState === state && state.commitMode === 'create-new-tab') {
    return commitSidebarTabReorder(state);
  }
  return commitSidebarPageDrop(state, target);
}

function handleSidebarPageDragPointerMove(event) {
  const state = sidebarPageDragState;
  if (!state || event.pointerId !== state.pointerId) return;
  const previousX = state.lastClientX;
  const previousY = state.lastClientY;
  state.lastClientX = event.clientX;
  state.lastClientY = event.clientY;
  if (state.phase === 'pressing' || state.phase === 'undecided-drag'
    || state.phase === 'navigation-extracted') {
    const liveSidebarRect = leftSidebar.getBoundingClientRect();
    if (state.phase === 'pressing' || state.phase === 'undecided-drag') {
      state.routingBoundaryDecision = sidebarPageDragModel.boundaryDecisionForSegment(
        state.routingBoundaryDecision,
        {
          previousX,
          previousY,
          clientX: event.clientX,
          clientY: event.clientY,
          sourceNameRect: state.sourceNameRect,
          sidebarLeft: liveSidebarRect.left,
          sidebarRight: liveSidebarRect.right
        }
      );
    }
    if (state.phase === 'pressing'
      && !sidebarPageDragModel.movementExceeded(
        state.startClientX,
        state.startClientY,
        event.clientX,
        event.clientY
      )) return;
    if (state.phase === 'pressing' && !startSidebarPageDrag(state)) return;
    const nextPhase = sidebarPageDragModel.nextPhase(state.phase, {
      previousX,
      clientX: event.clientX,
      sidebarRight: liveSidebarRect.right,
      boundaryDecision: state.routingBoundaryDecision,
      spatialPreviewEligible: state.navigationDragDescriptor?.spatialPreviewEligible !== false
    });
    const navigationStarted = nextPhase === 'navigation-extracted'
      && state.phase === 'undecided-drag';
    if (navigationStarted && !startSidebarPageNavigationExtraction(state)) return;
    if (navigationStarted
      && event.clientX > liveSidebarRect.right
      && state.navigationDragDescriptor?.spatialPreviewEligible !== false) {
      if (!transitionSidebarPageDragToPreview(state)) return;
    }
    if (nextPhase === 'spatial-preview'
      && !transitionSidebarPageDragToPreview(state)) return;
    if (state.phase === 'navigation-extracted') scheduleSidebarPageDragVisuals();
  }
  event.preventDefault();
  if (state.phase === 'spatial-preview') scheduleSidebarPageDragVisuals();
}

function handleSidebarPageDragPointerUp(event) {
  const state = sidebarPageDragState;
  if (!state || event.pointerId !== state.pointerId) return;
  if (state.phase === 'pressing' || state.phase === 'undecided-drag') {
    handleSidebarPageDragPointerMove(event);
    if (sidebarPageDragState !== state || state.cleanupComplete) return;
  }
  state.lastClientX = event.clientX;
  state.lastClientY = event.clientY;
  if (state.phase === 'pressing' || state.phase === 'undecided-drag') {
    finishSidebarPageDrag(state);
    return;
  }
  if (state.phase === 'navigation-extracted') {
    const liveSidebarRight = leftSidebar.getBoundingClientRect().right;
    if (event.clientX > liveSidebarRight
      && state.navigationDragDescriptor?.spatialPreviewEligible !== false) {
      if (!transitionSidebarPageDragToPreview(state)) return;
    } else {
      event.preventDefault();
      if (state.navigationDragDescriptor?.explicitMultiSelection) {
        const strip = hitTestTabStrip(event.clientX, event.clientY);
        const batchTabTarget = strip
          ? pagePreviewTabDropTarget(strip, event.clientX)
          : null;
        if (batchTabTarget) {
          commitSidebarPageBatchTabDrop(state, batchTabTarget);
          return;
        }
      }
      const target = updateSidebarPageNavigationPresentation(state);
      const descriptor = state.navigationDragDescriptor;
      releaseSidebarPageDragOwnership(state);
      if (target && typeof commitSidebarPageNavigationMembershipDrop === 'function') {
        commitSidebarPageNavigationMembershipDrop(descriptor, target);
      } else if (typeof restoreSidebarPageNavigationDrag === 'function') {
        restoreSidebarPageNavigationDrag(descriptor, 'no-navigation-target');
      }
      return;
    }
  }
  if (state.phase !== 'spatial-preview') return;
  event.preventDefault();
  const stripTarget = hitTestTabStripInterior(event.clientX, event.clientY);
  if (stripTarget?.ownerPaneId === getActivePane()?.id) {
    const target = pagePreviewTabDropTarget(stripTarget, event.clientX);
    if (beginSidebarTabStripEntry(state, target, { attachPointerListeners: false })) {
      commitSharedPageDrag(state, {
        kind: 'tab-strip',
        ...stripTarget,
        insertionIndex: state.provisionalIndex
      });
      return;
    }
  }
  const target = hitTestSidebarPageDropTarget(event.clientX, event.clientY);
  if (target) commitSharedPageDrag(state, target);
  else beginSidebarPageDragReturn(state);
}

function handleSidebarPageDragPointerCancel(event) {
  if (!sidebarPageDragState || event.pointerId !== sidebarPageDragState.pointerId) return;
  beginSidebarPageDragReturn(sidebarPageDragState);
}

function handleSidebarPageDragLostPointerCapture(event) {
  if (!sidebarPageDragState
    || sidebarPageDragState.phase === 'returning'
    || event.pointerId !== sidebarPageDragState.pointerId) return;
  beginSidebarPageDragReturn(sidebarPageDragState);
}

function handleSidebarPageDragKeyDown(event) {
  if (event.key !== 'Escape' || !sidebarPageDragState
    || sidebarPageDragState.phase === 'pressing') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  beginSidebarPageDragReturn(sidebarPageDragState);
}

function beginSidebarPageDrag(event, sourceRow, pageId) {
  const runtime = activePaneRuntime();
  if (!runtime || event.button !== 0 || event.isPrimary === false || runtime.linkPickMode
    || navigationMoveMode || sidebarPageDragState || tabReorderState
    || pageHistoryNavigationBlocked(runtime)) return false;
  const sourceRect = sourceRow.getBoundingClientRect();
  const sourceClipRect = sourceRow.closest?.('.left-sidebar-scroll-region')
    ?.getBoundingClientRect();
  const sourceNameRect = sidebarPageDragModel.visibleRectWithinClip(
    sourceRect,
    sourceClipRect
  ) || sourceRect;
  sidebarPageDragState = beginSharedPageDrag({
    event,
    pageId,
    source: {
      type: 'sidebar-page',
      commitMode: 'create-new-tab',
      originRect: sourceRect,
      pageId,
      element: sourceRow,
      paneId: null
    },
    state: {
      sourceType: 'tab-page',
      phase: 'pressing',
      preparePreview: false,
      commitMode: 'create-new-tab',
      sourceRow,
      sourceRect,
      sourceNameRect,
      routingBoundaryDecision: null,
      dropTarget: null,
      dropTargetSignature: '',
      navigationDragDescriptor: null,
      previewTabActive: false
    }
  });
  try {
    sourceRow.setPointerCapture?.(event.pointerId);
  } catch (_error) {
    // Window listeners preserve the gesture if capture is unavailable.
  }
  window.addEventListener('pointermove', handleSidebarPageDragPointerMove, { passive: false });
  window.addEventListener('pointerup', handleSidebarPageDragPointerUp);
  window.addEventListener('pointercancel', handleSidebarPageDragPointerCancel);
  return true;
}

function cancelSidebarPageDrag({ immediate = false } = {}) {
  const state = sidebarPageDragState;
  if (!state) return false;
  if (immediate || state.phase === 'pressing') finishSidebarPageDrag(state);
  else beginSidebarPageDragReturn(state);
  return true;
}

document.addEventListener('keydown', handleSidebarPageDragKeyDown, true);
window.addEventListener('blur', () => {
  if (!sidebarPageDragState) return;
  cancelSidebarPageDrag({ immediate: sidebarPageDragState.phase === 'pressing' });
});

function paneToolbarRegion(paneId) {
  if (!paneToolbarArea || !paneId) return null;
  return paneToolbarArea.querySelector(
    `.workspace-pane-toolbar-region[data-workspace-pane-id="${CSS.escape(paneId)}"]`
  );
}

function createViewerChromeIcon(name, ...classNames) {
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(namespace, 'svg');
  icon.setAttribute('viewBox', '0 0 18 18');
  icon.setAttribute('aria-hidden', 'true');
  icon.classList.add('viewer-chrome-icon', ...classNames.filter(Boolean));
  const use = document.createElementNS(namespace, 'use');
  use.setAttribute('href', `#viewer-icon-${name}`);
  icon.append(use);
  return icon;
}

function createPaneToolbarRegion(paneId) {
  const region = document.createElement('div');
  region.className = 'workspace-pane-toolbar-region';
  region.dataset.workspacePaneId = paneId;

  const toolbar = document.createElement('div');
  toolbar.className = 'pane-page-toolbar';
  toolbar.dataset.paneRole = 'page-toolbar';

  const left = document.createElement('div');
  left.className = 'toolbar-group toolbar-left';
  left.setAttribute('aria-label', 'Page navigation controls');
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'toolbar-button';
  back.dataset.paneRole = 'history-back';
  back.setAttribute('aria-label', 'Back');
  back.append(createViewerChromeIcon('back', 'viewer-history-back-icon'));
  back.disabled = true;
  const forward = document.createElement('button');
  forward.type = 'button';
  forward.className = 'toolbar-button';
  forward.dataset.paneRole = 'history-forward';
  forward.setAttribute('aria-label', 'Forward');
  forward.append(createViewerChromeIcon('forward', 'viewer-history-forward-icon'));
  forward.disabled = true;
  left.append(back, forward);

  const titleArea = document.createElement('div');
  titleArea.className = 'toolbar-title-area';
  const titleDisplay = document.createElement('button');
  titleDisplay.type = 'button';
  titleDisplay.className = 'page-title-display system-typography';
  titleDisplay.dataset.paneRole = 'page-title';
  const titleEditor = document.createElement('form');
  titleEditor.className = 'title-editor';
  titleEditor.dataset.paneRole = 'title-form';
  titleEditor.hidden = true;
  const titleInput = document.createElement('input');
  titleInput.className = 'title-input system-typography';
  titleInput.dataset.paneRole = 'title-input';
  titleInput.name = 'title';
  titleInput.type = 'text';
  titleInput.required = true;
  titleInput.setAttribute('aria-label', 'Edit current title');
  titleEditor.append(titleInput);
  const status = document.createElement('span');
  status.className = 'status';
  status.dataset.paneRole = 'status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  titleArea.append(titleDisplay, titleEditor, status);

  const right = document.createElement('div');
  right.className = 'toolbar-group toolbar-right';
  right.setAttribute('aria-label', 'Page action controls');
  const editContainer = document.createElement('div');
  editContainer.className = 'edit-menu-container';
  editContainer.dataset.paneRole = 'edit-container';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'toolbar-button edit-block-button';
  edit.dataset.paneRole = 'edit';
  edit.setAttribute('aria-label', 'Open edit menu');
  edit.title = 'Edit';
  edit.setAttribute('aria-haspopup', 'menu');
  edit.setAttribute('aria-expanded', 'false');
  edit.disabled = true;
  edit.append(createViewerChromeIcon('edit'));
  const menu = document.createElement('div');
  menu.className = 'edit-menu';
  menu.dataset.paneRole = 'edit-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  for (const [role, label] of [
    ['edit-block-menu-item', 'Edit block'],
    ['edit-page-menu-item', 'Edit page'],
    ['page-category-menu-item', 'Page category'],
    ['page-descriptor-menu-item', 'Page descriptor']
  ]) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'edit-menu-item';
    item.dataset.paneRole = role;
    item.setAttribute('role', 'menuitem');
    item.textContent = label;
    if (role === 'edit-page-menu-item') item.disabled = true;
    menu.append(item);
  }
  const pageTypeContainer = document.createElement('div');
  pageTypeContainer.className = 'page-type-menu-container';
  const pageTypeTrigger = document.createElement('button');
  pageTypeTrigger.type = 'button';
  pageTypeTrigger.className = 'edit-menu-item page-type-menu-trigger';
  pageTypeTrigger.dataset.paneRole = 'page-type-menu-trigger';
  pageTypeTrigger.setAttribute('role', 'menuitem');
  pageTypeTrigger.setAttribute('aria-haspopup', 'menu');
  pageTypeTrigger.setAttribute('aria-expanded', 'false');
  pageTypeTrigger.textContent = 'Page Type…';
  const pageTypeMenu = document.createElement('div');
  pageTypeMenu.className = 'edit-menu page-type-submenu';
  pageTypeMenu.dataset.paneRole = 'page-type-submenu';
  pageTypeMenu.setAttribute('role', 'menu');
  pageTypeMenu.hidden = true;
  for (const { id, label } of pageTypesModel.pageTypesForMenu()) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'edit-menu-item page-type-menu-item';
    item.dataset.paneRole = `page-type-${id}`;
    item.dataset.pageType = id;
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', 'false');
    item.textContent = label;
    pageTypeMenu.append(item);
  }
  pageTypeContainer.append(pageTypeTrigger, pageTypeMenu);
  menu.insertBefore(pageTypeContainer, menu.querySelector('[data-pane-role="page-category-menu-item"]'));
  editContainer.append(edit, menu);
  const highlightContainer = document.createElement('div');
  highlightContainer.className = 'highlight-menu-container';
  highlightContainer.dataset.paneRole = 'highlight-container';
  const highlight = document.createElement('button');
  highlight.type = 'button';
  highlight.className = 'toolbar-button';
  highlight.dataset.paneRole = 'highlight';
  highlight.setAttribute('aria-label', 'Highlight');
  highlight.title = 'Highlight';
  highlight.setAttribute('aria-haspopup', 'menu');
  highlight.setAttribute('aria-expanded', 'false');
  highlight.disabled = true;
  highlight.append(createViewerChromeIcon('highlight'));
  const highlightMenuElement = document.createElement('div');
  highlightMenuElement.className = 'highlight-menu';
  highlightMenuElement.dataset.paneRole = 'highlight-menu';
  highlightMenuElement.setAttribute('role', 'menu');
  highlightMenuElement.hidden = true;
  highlightContainer.append(highlight, highlightMenuElement);
  right.append(editContainer, highlightContainer);

  toolbar.append(left, titleArea, right);
  region.append(toolbar);
  return region;
}

function ensurePaneToolbarRegion(paneId) {
  let region = paneToolbarRegion(paneId);
  if (!region) {
    region = createPaneToolbarRegion(paneId);
    paneToolbarArea?.append(region);
  }
  return region;
}

function paneToolbarDomReferences(paneId) {
  const region = ensurePaneToolbarRegion(paneId);
  const role = (name) => region?.querySelector(`[data-pane-role="${name}"]`) || null;
  return {
    toolbarRegion: region,
    pageToolbar: role('page-toolbar'),
    pageHistoryBackButton: role('history-back'),
    pageHistoryForwardButton: role('history-forward'),
    pageTitleDisplay: role('page-title'),
    titleForm: role('title-form'),
    pageTitle: role('title-input'),
    statusEl: role('status'),
    editMenuContainer: role('edit-container'),
    editBlockButton: role('edit'),
    editMenu: role('edit-menu'),
    editBlockMenuItem: role('edit-block-menu-item'),
    editPageMenuItem: role('edit-page-menu-item'),
    pageTypeMenuTrigger: role('page-type-menu-trigger'),
    pageTypeSubmenu: role('page-type-submenu'),
    pageTypeMenuItems: [...(region?.querySelectorAll('[data-page-type]') || [])],
    pageCategoryMenuItem: role('page-category-menu-item'),
    pageDescriptorMenuItem: role('page-descriptor-menu-item'),
    highlightButton: role('highlight'),
    highlightMenuContainer: role('highlight-container'),
    highlightMenu: role('highlight-menu')
  };
}

function paneDomReferences(element, paneId = element?.dataset?.workspacePaneId) {
  if (!element) return {};
  return {
    ...paneToolbarDomReferences(paneId),
    canvasArea: element.querySelector('.canvas-area'),
    canvasStage: element.querySelector('.canvas-stage'),
    infoPanelLayer: element.querySelector('.info-panel-layer'),
    emptyCanvas: element.querySelector('.empty-canvas'),
    emptyTabState: element.querySelector('.empty-tab-state'),
    emptyTabGoToPageButton: element.querySelector('[data-empty-tab-action="go-to-page"]'),
    emptyTabCreatePageButton: element.querySelector('[data-empty-tab-action="create-page"]'),
    emptyTabCloseButton: element.querySelector('[data-empty-tab-action="close"]')
  };
}

let nextPaneRuntimeId = 0;

function createPaneViewContext(paneId, dom = {}, session = null) {
  return {
    runtimeId: `pane-runtime-${++nextPaneRuntimeId}`,
    lifecycleEpoch: 1,
    disposed: false,
    paneId,
    session,
    dom,
    currentPage: null,
    currentPageEntry: null,
    pageLoadSequence: 0,
    loadGeneration: 0,
    mounted: { generation: 0, pageId: null, kind: null },
    statusTimer: null,
    pageHistoryNavigationInProgress: false,
    cancelTitleBlur: false,
    titleSaveInProgress: false,
    markdownRecenterFrame: 0,
    canvasObjects: [],
    canvasBounds: null,
    canvasView: { scale: 1, offsetX: 0, offsetY: 0 },
    gestureStartScale: 1,
    canvasImageSessionPageId: null,
    canvasImageSessionGeneration: 0,
    canvasImageResolutionTimer: null,
    canvasImageVariantStates: new Map(),
    blockEditMode: false,
    blockSaveInProgress: false,
    originalBlocks: [],
    draftBlocks: [],
    blockDrawing: null,
    blockPreview: null,
    selectedBlockId: null,
    blockTransform: null,
    canvasUndoContextId: null,
    pageEditMode: false,
    pageEditSaveInProgress: false,
    originalPageObjects: [],
    originalPageBlocks: [],
    originalPageTextFrame: null,
    draftPageObjects: [],
    draftPageBlocks: [],
    draftPageTextFrame: null,
    selectedPageObjectId: null,
    pageObjectDrag: null,
    blockVisualMode: BLOCK_MODE.NORMAL,
    activeHighlightGroupId: null,
    activeHighlightBlockIds: new Set(),
    selectedHighlightBlockIds: new Set(),
    highlightEditDraft: null,
    highlightSaveInProgress: false,
    infoPanelsSuspended: false,
    infoPanelEditor: null,
    infoPanelEditorRevision: 0,
    suspendedInfoPanelEditor: null,
    infoPanelGeometryGesture: null,
    infoPanelFocusFrame: null,
    temporaryInfoBlockId: null,
    blockStateRequests: new WeakMap(),
    hoveredCanvasBlockId: null,
    externalLinkHoveredBlockId: null,
    quickColour: null,
    addLinkTarget: null,
    addLinkSelection: null,
    addLinkInProgress: false,
    linkPickMode: null,
    externalLinkEditorController: null,
    externalLinkEditorContext: null
  };
}

function getWorkspacePane(paneId) {
  return workspace.paneById(paneId);
}

function getActivePane() {
  return workspace.activePane();
}

function runtimeForPane(paneOrId) {
  const pane = typeof paneOrId === 'string' ? getWorkspacePane(paneOrId) : paneOrId;
  const runtime = pane?.viewContext;
  if (!runtime || runtime.disposed || runtime.paneId !== pane.id) return null;
  return runtime.session === pane.session ? runtime : null;
}

function activePaneRuntime() {
  return runtimeForPane(workspace.state.activePaneId);
}

function livingPaneRuntimes() {
  return workspace.state.panes.map(runtimeForPane).filter(Boolean);
}

function runtimeIsLive(runtime) {
  if (!runtime || runtime.disposed) return false;
  const pane = getWorkspacePane(runtime.paneId);
  return Boolean(pane && pane.viewContext === runtime && pane.session === runtime.session);
}

function captureRuntimeOperation(runtime, detail = {}) {
  if (!runtimeIsLive(runtime)) return null;
  const tab = runtime.session?.activeTab?.() || null;
  return {
    ...detail,
    runtime,
    runtimeId: runtime.runtimeId,
    lifecycleEpoch: runtime.lifecycleEpoch,
    session: runtime.session,
    tab,
    tabId: tab?.id || null,
    pageId: detail.pageId ?? tab?.currentPageId ?? runtime.currentPage?.id ?? null,
    pageLoadGeneration: runtime.pageLoadSequence,
    mountGeneration: runtime.mounted?.generation ?? 0,
    requireTab: detail.requireTab ?? true,
    requirePage: detail.requirePage ?? true,
    requirePageLoad: detail.requirePageLoad ?? true,
    requireMount: detail.requireMount ?? true
  };
}

function runtimeOperationOwnerIsCurrent(operation) {
  const runtime = operation?.runtime;
  return Boolean(runtimeIsLive(runtime)
    && runtime.runtimeId === operation.runtimeId
    && runtime.lifecycleEpoch === operation.lifecycleEpoch
    && runtime.session === operation.session);
}

function runtimeOperationIsCurrent(operation) {
  const runtime = operation?.runtime;
  if (!runtimeOperationOwnerIsCurrent(operation)) return false;
  if (operation.requirePageLoad
    && runtime.pageLoadSequence !== operation.pageLoadGeneration) return false;
  if (operation.requireMount
    && (runtime.mounted?.generation ?? 0) !== operation.mountGeneration) return false;
  const tab = runtime.session?.activeTab?.() || null;
  if (operation.requireTab && (tab !== operation.tab || (tab?.id || null) !== operation.tabId)) {
    return false;
  }
  return !operation.requirePage || operation.pageId === null
    || (tab?.currentPageId || runtime.currentPage?.id || null) === operation.pageId;
}

function createPaneCanvasElement(paneId) {
  const element = document.createElement('section');
  element.className = 'workspace-pane';
  element.dataset.workspacePaneId = paneId;
  const area = document.createElement('div');
  area.className = 'page-body canvas-area';
  const stage = document.createElement('div');
  stage.className = 'canvas-stage';
  const empty = document.createElement('p');
  empty.className = 'empty-canvas';
  empty.hidden = true;
  empty.textContent = 'Empty canvas';
  const emptyState = document.createElement('div');
  emptyState.className = 'empty-tab-state';
  emptyState.hidden = true;
  emptyState.setAttribute('aria-label', 'New Tab actions');
  const actions = document.createElement('div');
  actions.className = 'empty-tab-actions';
  for (const [action, label] of [
    ['create-page', 'Create New Page'],
    ['go-to-page', 'Go to Page'],
    ['close', 'Close']
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `empty-tab-action ${action === 'create-page' ? 'ui-solid-action' : 'ui-outline-action'}`;
    button.dataset.emptyTabAction = action;
    button.textContent = label;
    actions.append(button);
  }
  emptyState.append(actions);
  const infoPanels = document.createElement('div');
  infoPanels.className = 'info-panel-layer';
  infoPanels.dataset.paneId = paneId;
  area.append(stage, empty, emptyState, infoPanels);
  element.append(area);
  return element;
}

function initializeWorkspacePaneModel() {
  if (workspace.state.panes.length) return getActivePane();
  const element = workspacePaneRoot?.querySelector('.workspace-pane');
  if (!element) return null;
  element.dataset.workspacePaneId = 'main-pane';
  const session = sessionTabsModel.createTabSession();
  const context = createPaneViewContext('main-pane', paneDomReferences(element), session);
  const pane = workspace.reset({
    id: 'main-pane',
    session,
    viewContext: context
  });
  pane.element = element;
  return pane;
}

function workspacePanesInRenderOrder() {
  const provisionalIds = paneReorderState?.phase === 'reordering'
    ? paneReorderState.provisionalPaneIds
    : null;
  if (!Array.isArray(provisionalIds) || provisionalIds.length !== workspace.state.panes.length) {
    return workspace.state.panes;
  }
  const byId = new Map(workspace.state.panes.map((pane) => [pane.id, pane]));
  const ordered = provisionalIds.map((paneId) => byId.get(paneId)).filter(Boolean);
  return ordered.length === workspace.state.panes.length ? ordered : workspace.state.panes;
}

function pageForWorkspacePane(pane) {
  const pageId = pane?.session?.activeTab?.()?.currentPageId;
  if (!pageId) return null;
  return canonicalPages.get(pageId)
    || (pane.viewContext?.currentPage?.id === pageId ? pane.viewContext.currentPage : null)
    || pageIndex?.pages?.find((entry) => entry.id === pageId)
    || null;
}

function paneHistoryTarget(pane, direction) {
  if (!pane?.session) return null;
  return pane.session.historyTarget(direction, pageHistoryEntryExists);
}

function updatePanePageTypeMenu(pane, page) {
  const dom = pane?.viewContext?.dom;
  if (!dom?.pageTypeMenuTrigger) return;
  const hasPage = pageIsSupported(page);
  const currentType = pageTypesModel.normalizePageType(page?.type);
  dom.pageTypeMenuTrigger.disabled = !hasPage;
  for (const item of dom.pageTypeMenuItems || []) {
    if (!item) continue;
    const targetType = item.dataset.pageType;
    const selected = hasPage && targetType === currentType;
    const eligibility = hasPage
      ? pageTypesModel.conversionEligibility(page, targetType)
      : { allowed: false, reasons: [] };
    item.setAttribute('aria-checked', String(selected));
    item.classList.toggle('is-current', selected);
    item.disabled = !selected && !eligibility.allowed;
    item.title = item.disabled ? eligibility.reasons.join(' ') : '';
  }
}

function updatePaneToolbarPresentation(pane) {
  const runtime = runtimeForPane(pane);
  const dom = runtime?.dom;
  if (!pane || !runtime || !dom?.pageToolbar) return;
  const tab = pane.session.activeTab();
  const page = pageForWorkspacePane(pane);
  const isActivePane = pane.id === workspace.state.activePaneId;
  const hasPage = Boolean(tab?.currentPageId && pageIsSupported(page));
  const supportsCanvas = hasPage
    && pageTypesModel.pageTypeSupports(page.type, 'canvas');
  const supportsPageEdit = hasPage
    && pageTypesModel.pageTypeSupports(page.type, 'page-edit');
  const pageEditType = pageTypesModel.normalizePageType(page?.type);
  const hasPageEditImplementation = pageEditType === pageTypesModel.PAGE_TYPES.CANVAS
    || pageEditType === pageTypesModel.PAGE_TYPES.MARKDOWN
    || pageEditType === pageTypesModel.PAGE_TYPES.HN_TEXT;
  const pageEditing = runtime.blockEditMode || runtime.pageEditMode;
  const highlightEditing = runtime.highlightEditDraft?.paneId === pane.id;
  const title = hasPage ? pageTitleForTab(tab) : '';

  dom.toolbarRegion.classList.toggle('is-workspace-pane-collapsed', pane.mode === 'collapsed');
  dom.toolbarRegion.classList.toggle('is-workspace-pane-active', isActivePane);
  if (dom.titleForm.hidden || !isActivePane) {
    dom.pageTitleDisplay.textContent = title;
    dom.pageTitle.value = title;
  }
  dom.pageTitleDisplay.disabled = !hasPage;
  dom.pageHistoryBackButton.disabled = !hasPage || !paneHistoryTarget(pane, -1);
  dom.pageHistoryForwardButton.disabled = !hasPage || !paneHistoryTarget(pane, 1);

  const canEditBlocks = supportsCanvas && pageHasBlockEditTarget(page);
  const visibleObjectCount = supportsCanvas
    ? (page.objects || []).filter((object) => isDisplayableObject(object) && isVisibleObject(object)).length
    : 0;
  dom.editBlockButton.disabled = !hasPage || highlightEditing;
  dom.editBlockMenuItem.disabled = !canEditBlocks;
  dom.editPageMenuItem.disabled = !supportsPageEdit || !hasPageEditImplementation
    || (pageEditType === pageTypesModel.PAGE_TYPES.CANVAS
      && visibleObjectCount < 2);
  dom.pageCategoryMenuItem.disabled = !hasPage;
  dom.pageDescriptorMenuItem.disabled = !hasPage;
  dom.editBlockButton.classList.toggle('is-active', pageEditing);
  dom.editBlockButton.replaceChildren(createViewerChromeIcon(pageEditing ? 'check' : 'edit'));
  dom.editBlockButton.setAttribute('aria-label', pageEditing
    ? (runtime.pageEditMode ? 'Save page layout' : 'Save blocks')
    : 'Open edit menu');
  dom.editBlockButton.title = pageEditing
    ? (runtime.pageEditMode ? 'Save page layout' : 'Save blocks')
    : 'Edit';

  const groups = Array.isArray(page?.highlightGroups) ? page.highlightGroups : [];
  const validGroupIds = new Set(groups.map((group) => group.id));
  const highlighted = checkedHighlightGroupIdsForViewState(tab?.viewState)
    .some((groupId) => validGroupIds.has(groupId));
  dom.highlightButton.disabled = !supportsCanvas || pageEditing || runtime.highlightSaveInProgress;
  dom.highlightButton.classList.toggle('edit-block-button', highlightEditing);
  dom.highlightButton.classList.toggle('is-active', highlighted || highlightEditing);
  dom.highlightButton.replaceChildren(createViewerChromeIcon(highlightEditing ? 'check' : 'highlight'));
  dom.highlightButton.setAttribute('aria-label', highlightEditing
    ? 'Save Highlight Group'
    : 'Highlight');
  dom.highlightButton.title = highlightEditing ? 'Save Highlight Group' : 'Highlight';
  dom.highlightButton.setAttribute('aria-pressed', String(highlighted));
  updatePanePageTypeMenu(pane, page);
}

function renderPaneToolbarCollection() {
  if (!paneToolbarArea) return;
  const validPaneIds = new Set(workspace.state.panes.map((pane) => pane.id));
  for (const region of paneToolbarArea.querySelectorAll('.workspace-pane-toolbar-region')) {
    if (!validPaneIds.has(region.dataset.workspacePaneId)) region.remove();
  }
  for (const pane of workspacePanesInRenderOrder()) {
    const region = ensurePaneToolbarRegion(pane.id);
    paneToolbarArea.append(region);
    Object.assign(pane.viewContext.dom, paneToolbarDomReferences(pane.id));
    updatePaneToolbarPresentation(pane);
    if (typeof bindWorkspacePaneInteractions === 'function') bindWorkspacePaneInteractions(pane);
  }
}

function applyWorkspacePaneGeometry() {
  const paneIntervals = [];
  let paneCursor = 0;
  for (const pane of workspace.state.panes) {
    const numericWidth = Math.max(0, pane.width);
    const width = `${numericWidth}px`;
    paneIntervals.push({ pane, start: paneCursor, end: paneCursor + numericWidth });
    paneCursor += numericWidth;
    if (pane.element) {
      pane.element.style.flex = `0 0 ${width}`;
      pane.element.style.width = width;
      pane.element.style.minWidth = width;
      pane.element.style.maxWidth = width;
      pane.element.dataset.paneMode = pane.mode;
      pane.element.classList.toggle('is-workspace-pane-collapsed', pane.mode === 'collapsed');
    }
    const toolbarRegion = paneToolbarRegion(pane.id);
    if (toolbarRegion) {
      toolbarRegion.style.flex = `0 0 ${width}`;
      toolbarRegion.style.width = width;
      toolbarRegion.style.minWidth = width;
      toolbarRegion.style.maxWidth = width;
      toolbarRegion.dataset.paneMode = pane.mode;
      toolbarRegion.classList.toggle('is-workspace-pane-collapsed', pane.mode === 'collapsed');
    }
  }

  const rootRect = workspacePaneRoot?.getBoundingClientRect();
  const tabAreaRect = topTabArea?.getBoundingClientRect();
  const headerStart = rootRect && tabAreaRect
    ? Math.max(0, Math.min(rootRect.width, tabAreaRect.left - rootRect.left))
    : 0;
  const headerEnd = rootRect && tabAreaRect
    ? Math.max(headerStart, Math.min(rootRect.width, tabAreaRect.right - rootRect.left))
    : paneCursor;
  for (const { pane, start, end } of paneIntervals) {
    const visibleWidth = Math.max(0, Math.min(end, headerEnd) - Math.max(start, headerStart));
    const width = `${visibleWidth}px`;
    const region = paneTabRegion(pane.id);
    if (!region) continue;
    region.style.flex = `0 0 ${width}`;
    region.style.width = width;
    region.style.minWidth = width;
    region.style.maxWidth = width;
    region.dataset.paneMode = pane.mode;
    region.classList.toggle('is-workspace-pane-collapsed', pane.mode === 'collapsed');
  }
}

function renderWorkspacePaneLayout() {
  if (!workspacePaneRoot) return;
  const orderedPanes = workspacePanesInRenderOrder();
  const orderedElements = orderedPanes.map((pane) => pane.element);
  const mountedElements = [...workspacePaneRoot.children];
  const orderChanged = mountedElements.length !== orderedElements.length
    || orderedElements.some((element, index) => mountedElements[index] !== element);
  if (orderChanged) workspacePaneRoot.replaceChildren(...orderedElements);
  workspacePaneRoot.style.setProperty('--workspace-pane-count', String(workspace.state.panes.length));
  for (const pane of workspace.state.panes) {
    pane.element.classList.toggle('is-workspace-pane-active', pane.id === workspace.state.activePaneId);
    pane.element.classList.toggle(
      'is-pane-reorder-source',
      paneReorderState?.phase === 'reordering' && pane.id === paneReorderState.paneId
    );
    const area = pane.element.querySelector('.canvas-area');
    if (area) area.setAttribute('aria-hidden', String(pane.mode === 'collapsed'));
  }
  applyWorkspacePaneGeometry();
  scheduleWorkspacePaneChromeLayout();
}

function workspacePaneLayoutSignature() {
  return workspace.state.panes.map((pane) => [
    pane.id,
    pane.mode,
    Math.round(pane.width * 100) / 100
  ].join(':')).join('|');
}

function workspacePaneStructureSignature() {
  return workspace.state.panes.map((pane) => `${pane.id}:${pane.mode}`).join('|');
}

function workspacePaneAvailableWidth() {
  // Preserve the grid track's fractional CSS-pixel width while a Sidebar is
  // moving. clientWidth rounds that track to an integer; rounding upward can
  // make an explicitly sized Pane fractionally wider than its clipped root,
  // which is enough to create a document scrollbar at the collapse endpoint.
  const width = workspacePaneRoot?.getBoundingClientRect().width;
  return Number.isFinite(width) && width > 0 ? width : 0;
}

function renderWorkspacePaneStackState({
  preserveTabLeftAnchor = false,
  preserveTabTitlePresentation = false
} = {}) {
  renderPaneToolbarCollection();
  renderWorkspacePaneLayout();
  renderTabStrip({
    preserveLayoutTransition: true,
    preserveLeftAnchor: preserveTabLeftAnchor,
    preserveTitlePresentation: preserveTabTitlePresentation
  });
  scheduleWorkspacePaneChromeLayout();
}

function fitWorkspacePanesToAvailableWidth() {
  if (!workspacePaneRoot || paneDividerDragState || paneReorderState?.phase === 'reordering') {
    return false;
  }
  const availableWidth = workspacePaneAvailableWidth();
  if (!(availableWidth > 0)) return false;
  const before = workspacePaneLayoutSignature();
  const beforeStructure = workspacePaneStructureSignature();
  workspace.fitToWidth(availableWidth);
  const changed = before !== workspacePaneLayoutSignature();
  const structureChanged = beforeStructure !== workspacePaneStructureSignature();
  if (structureChanged) renderWorkspacePaneStackState();
  else {
    // A width-only fit must not detach and reappend the existing Pane nodes.
    // Apply explicit Pane/toolbar widths in place so active editors retain
    // focus, DOM Selection, and their mounted runtime identity.
    applyWorkspacePaneGeometry();
    scheduleWorkspacePaneChromeLayout();
  }
  return changed;
}

function initializeWorkspacePaneStackLayout() {
  if (!workspacePaneRoot || typeof ResizeObserver !== 'function') return;
  if (!workspacePaneResizeObserver) {
    workspacePaneResizeObserver = new ResizeObserver(() => {
      // ResizeObserver already runs before paint. Fit the explicit Pane widths
      // here so Canvas/editor hit geometry follows the Sidebar grid in the
      // same rendered frame instead of one scheduled frame later.
      fitWorkspacePanesToAvailableWidth();
    });
  }
  workspacePaneResizeObserver.observe(workspacePaneRoot);
  fitWorkspacePanesToAvailableWidth();
}

function ensureWorkspacePaneChromeLayer() {
  let layer = document.querySelector('.workspace-pane-chrome-layer');
  if (layer) return layer;
  layer = document.createElement('div');
  layer.className = 'workspace-pane-chrome-layer';
  layer.setAttribute('aria-hidden', 'false');
  document.body.append(layer);
  return layer;
}

function workspacePaneSpineTitle(pane) {
  return pageTitleForTab(pane?.session?.activeTab?.());
}

function positionFixedPaneControl(element, { left, top, width, height }) {
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
  element.style.width = `${Math.max(0, width)}px`;
  element.style.height = `${Math.max(0, height)}px`;
}

function renderWorkspacePaneChromeLayout() {
  const layer = ensureWorkspacePaneChromeLayer();
  const rootRect = workspacePaneRoot?.getBoundingClientRect();
  const tabAreaRect = topTabArea?.getBoundingClientRect();
  if (!rootRect || rootRect.width <= 0 || rootRect.height <= 0) {
    layer.replaceChildren();
    return;
  }
  const validSpines = new Set();
  for (const pane of workspace.state.panes) {
    if (pane.mode !== 'collapsed') continue;
    const paneRect = pane.element?.getBoundingClientRect();
    const toolbarRect = paneToolbarRegion(pane.id)?.getBoundingClientRect();
    if (!paneRect || !toolbarRect || !tabAreaRect) continue;
    const regionRect = {
      left: paneRect.left,
      right: paneRect.right,
      top: tabAreaRect.bottom,
      width: paneRect.width
    };
    validSpines.add(pane.id);
    let spine = layer.querySelector(
      `.workspace-pane-collapsed-spine[data-pane-id="${CSS.escape(pane.id)}"]`
    );
    if (!spine) {
      spine = document.createElement('button');
      spine.type = 'button';
      spine.className = 'workspace-pane-collapsed-spine';
      spine.dataset.paneId = pane.id;
      spine.addEventListener('pointerdown', handleCollapsedPanePointerDown);
      spine.addEventListener('click', (event) => event.preventDefault());
      const title = document.createElement('span');
      title.className = 'workspace-pane-collapsed-title';
      spine.append(title);
      layer.append(spine);
    }
    spine.querySelector('.workspace-pane-collapsed-title').textContent = workspacePaneSpineTitle(pane);
    spine.setAttribute('aria-label', `Expand ${workspacePaneSpineTitle(pane)}`);
    spine.classList.toggle('is-workspace-pane-active', pane.id === workspace.state.activePaneId);
    spine.classList.toggle(
      'is-pane-reorder-source',
      paneReorderState?.phase === 'reordering' && pane.id === paneReorderState.paneId
    );
    spine.style.setProperty(
      '--collapsed-pane-title-offset',
      `${Math.max(0, toolbarRect.top - regionRect.top)}px`
    );
    positionFixedPaneControl(spine, {
      left: regionRect.left,
      top: regionRect.top,
      width: regionRect.width,
      height: rootRect.bottom - regionRect.top
    });
  }
  for (const spine of layer.querySelectorAll('.workspace-pane-collapsed-spine')) {
    if (!validSpines.has(spine.dataset.paneId)) spine.remove();
  }

  const orderedPanes = workspacePanesInRenderOrder();
  const validDividers = new Set();
  for (let index = 0; index < orderedPanes.length - 1; index += 1) {
    const leftPane = orderedPanes[index];
    const rightPane = orderedPanes[index + 1];
    const rightPaneRect = rightPane.element?.getBoundingClientRect();
    if (!rightPaneRect || !tabAreaRect) continue;
    const dividerId = `${leftPane.id}:${rightPane.id}`;
    validDividers.add(dividerId);
    let divider = layer.querySelector(
      `.workspace-pane-divider[data-divider-id="${CSS.escape(dividerId)}"]`
    );
    if (!divider) {
      divider = document.createElement('button');
      divider.type = 'button';
      divider.className = 'workspace-pane-divider';
      divider.dataset.dividerId = dividerId;
      divider.setAttribute('aria-label', 'Resize Panes');
      divider.addEventListener('pointerdown', handlePaneDividerPointerDown);
      layer.append(divider);
    }
    divider.dataset.dividerIndex = String(index);
    divider.dataset.leftPaneId = leftPane.id;
    divider.dataset.rightPaneId = rightPane.id;
    positionFixedPaneControl(divider, {
      left: rightPaneRect.left - 4,
      top: tabAreaRect.top,
      width: 9,
      height: rootRect.bottom - tabAreaRect.top
    });
  }
  for (const divider of layer.querySelectorAll('.workspace-pane-divider')) {
    if (!validDividers.has(divider.dataset.dividerId)) divider.remove();
  }
  layer.classList.toggle('is-pane-reordering', paneReorderState?.phase === 'reordering');
}

function scheduleWorkspacePaneChromeLayout() {
  if (workspacePaneChromeFrame) window.cancelAnimationFrame(workspacePaneChromeFrame);
  workspacePaneChromeFrame = window.requestAnimationFrame(() => {
    workspacePaneChromeFrame = 0;
    renderWorkspacePaneChromeLayout();
  });
}

function expandCollapsedWorkspacePane(paneId) {
  const pane = getWorkspacePane(paneId);
  if (!pane || pane.mode !== 'collapsed' || !workspacePaneRoot) return false;
  const availableWidth = workspacePaneAvailableWidth();
  if (!workspace.expandPane(paneId, availableWidth)) return false;
  if (availableWidth > 0) workspace.fitToWidth(availableWidth);
  renderWorkspacePaneStackState();
  setActiveWorkspacePane(paneId);
  return true;
}

function removePaneDividerPointerListeners() {
  window.removeEventListener('pointermove', handlePaneDividerPointerMove, true);
  window.removeEventListener('pointerup', handlePaneDividerPointerUp, true);
  window.removeEventListener('pointercancel', handlePaneDividerPointerCancel, true);
}

function finishPaneDividerDrag({ cancel = false } = {}) {
  const state = paneDividerDragState;
  if (!state) return;
  if (paneDividerDragFrame) window.cancelAnimationFrame(paneDividerDragFrame);
  paneDividerDragFrame = 0;
  removePaneDividerPointerListeners();
  if (state.element?.hasPointerCapture?.(state.pointerId)) {
    try { state.element.releasePointerCapture(state.pointerId); } catch (_error) {}
  }
  if (cancel) workspace.restoreLayout(state.originalLayout);
  paneDividerDragState = null;
  document.body.classList.remove('is-pane-divider-resizing');
  renderWorkspacePaneStackState();
}

function applyPaneDividerDragFrame() {
  paneDividerDragFrame = 0;
  const state = paneDividerDragState;
  if (!state) return;
  const pointerDelta = state.lastClientX - state.startClientX;
  const delta = pointerDelta - state.appliedPointerDelta;
  if (Math.abs(delta) > 0.000001) {
    workspace.resizeAtDivider(state.dividerIndex, delta, {
      overdragState: state.overdragState
    });
    state.appliedPointerDelta = pointerDelta;
  }
  renderWorkspacePaneStackState({
    preserveTabLeftAnchor: true,
    preserveTabTitlePresentation: true
  });
}

function handlePaneDividerPointerDown(event) {
  if (event.button !== 0 || event.isPrimary === false || paneDividerDragState
    || paneReorderState || tabReorderState || sidebarPageDragState) return;
  const dividerIndex = Number.parseInt(event.currentTarget.dataset.dividerIndex, 10);
  if (!Number.isInteger(dividerIndex)) return;
  event.preventDefault();
  paneDividerDragState = {
    sourceType: 'pane-divider',
    pointerId: event.pointerId,
    element: event.currentTarget,
    dividerIndex,
    startClientX: event.clientX,
    lastClientX: event.clientX,
    appliedPointerDelta: 0,
    overdragState: {
      compressSide: null,
      collapseOverdrag: 0,
      candidatePaneId: null,
      triggerDistance: 0,
      expansionPaneId: null,
      expansionDirection: 0,
      expansionOverdrag: 0,
      expansionTriggerDistance: 0,
      protectedExpandedPaneIds: []
    },
    originalLayout: workspace.captureLayout()
  };
  try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch (_error) {}
  document.body.classList.add('is-pane-divider-resizing');
  window.addEventListener('pointermove', handlePaneDividerPointerMove, {
    capture: true,
    passive: false
  });
  window.addEventListener('pointerup', handlePaneDividerPointerUp, true);
  window.addEventListener('pointercancel', handlePaneDividerPointerCancel, true);
}

function handlePaneDividerPointerMove(event) {
  if (!paneDividerDragState || event.pointerId !== paneDividerDragState.pointerId) return;
  event.preventDefault();
  paneDividerDragState.lastClientX = event.clientX;
  if (!paneDividerDragFrame) {
    paneDividerDragFrame = window.requestAnimationFrame(applyPaneDividerDragFrame);
  }
}

function handlePaneDividerPointerUp(event) {
  if (!paneDividerDragState || event.pointerId !== paneDividerDragState.pointerId) return;
  paneDividerDragState.lastClientX = event.clientX;
  applyPaneDividerDragFrame();
  finishPaneDividerDrag();
}

function handlePaneDividerPointerCancel(event) {
  if (!paneDividerDragState || event.pointerId !== paneDividerDragState.pointerId) return;
  finishPaneDividerDrag({ cancel: true });
}

function removePaneReorderPointerListeners() {
  window.removeEventListener('pointermove', handleCollapsedPanePointerMove);
  window.removeEventListener('pointerup', handleCollapsedPanePointerUp);
  window.removeEventListener('pointercancel', handleCollapsedPanePointerCancel);
}

function paneReorderInsertionIndex(clientX, draggedPaneId) {
  const stationary = workspacePanesInRenderOrder().filter((pane) => pane.id !== draggedPaneId);
  for (let index = 0; index < stationary.length; index += 1) {
    const rect = stationary[index].element?.getBoundingClientRect();
    if (rect && clientX < rect.left + rect.width / 2) return index;
  }
  return stationary.length;
}

function provisionalPaneOrder(draggedPaneId, insertionIndex) {
  const stationaryIds = workspace.state.panes
    .map((pane) => pane.id)
    .filter((paneId) => paneId !== draggedPaneId);
  stationaryIds.splice(
    Math.min(stationaryIds.length, Math.max(0, insertionIndex)),
    0,
    draggedPaneId
  );
  return stationaryIds;
}

function beginCollapsedPaneReorder(state) {
  if (!state || state.phase !== 'pressing') return;
  state.phase = 'reordering';
  state.provisionalPaneIds = [...state.originalPaneIds];
  const rect = state.element.getBoundingClientRect();
  state.sourceRect = rect;
  state.grabOffsetX = state.lastClientX - rect.left;
  state.grabOffsetY = state.lastClientY - rect.top;
  const tabAreaRect = topTabArea?.getBoundingClientRect();
  if (tabAreaRect) {
    const slotRect = {
      left: rect.left,
      top: tabAreaRect.top,
      width: rect.width,
      height: tabAreaRect.height
    };
    const placeholder = document.createElement('div');
    placeholder.className = 'workspace-pane-reorder-slot-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    positionFixedPaneControl(placeholder, slotRect);
    ensureWorkspacePaneChromeLayer().append(placeholder);
    state.sourcePlaceholder = placeholder;
  }
  const visual = state.element.cloneNode(true);
  visual.classList.remove('is-workspace-pane-active', 'is-pane-reorder-source');
  visual.classList.add('workspace-pane-reorder-preview');
  visual.removeAttribute('data-pane-id');
  visual.setAttribute('aria-hidden', 'true');
  positionFixedPaneControl(visual, rect);
  document.body.append(visual);
  state.previewElement = visual;
  renderWorkspacePaneStackState();
  updateCollapsedPaneReorderVisual(state);
}

function updateCollapsedPaneReorderVisual(state) {
  if (!state?.previewElement) return;
  state.previewElement.style.transform = `translate3d(${state.lastClientX - state.sourceRect.left - state.grabOffsetX}px, ${state.lastClientY - state.sourceRect.top - state.grabOffsetY}px, 0)`;
  const insertionIndex = paneReorderInsertionIndex(state.lastClientX, state.paneId);
  const nextOrder = provisionalPaneOrder(state.paneId, insertionIndex);
  if (nextOrder.join('|') !== state.provisionalPaneIds.join('|')) {
    state.provisionalPaneIds = nextOrder;
    renderWorkspacePaneStackState();
  }
}

function applyCollapsedPaneReorderFrame() {
  paneReorderFrame = 0;
  if (paneReorderState?.phase === 'reordering') {
    updateCollapsedPaneReorderVisual(paneReorderState);
  }
}

function clearCollapsedPaneReorder(state, { commit = false } = {}) {
  if (!state) return;
  if (state.longPressTimer) window.clearTimeout(state.longPressTimer);
  if (paneReorderFrame) window.cancelAnimationFrame(paneReorderFrame);
  paneReorderFrame = 0;
  removePaneReorderPointerListeners();
  if (state.element?.hasPointerCapture?.(state.pointerId)) {
    try { state.element.releasePointerCapture(state.pointerId); } catch (_error) {}
  }
  if (commit) {
    const insertionIndex = state.provisionalPaneIds.indexOf(state.paneId);
    workspace.reorderPane(state.paneId, insertionIndex);
  }
  state.sourcePlaceholder?.remove();
  state.previewElement?.remove();
  paneReorderState = null;
  renderWorkspacePaneStackState();
}

function paneReorderDropIsValid(clientX, clientY) {
  const rootRect = workspacePaneRoot?.getBoundingClientRect();
  const tabRect = topTabArea?.getBoundingClientRect();
  if (!rootRect || !tabRect) return false;
  return clientX >= rootRect.left && clientX <= rootRect.right
    && clientY >= tabRect.top && clientY <= rootRect.bottom;
}

function handleCollapsedPanePointerDown(event) {
  if (event.button !== 0 || event.isPrimary === false || paneReorderState
    || paneDividerDragState || tabReorderState || sidebarPageDragState) return;
  const paneId = event.currentTarget.dataset.paneId;
  const pane = getWorkspacePane(paneId);
  if (!pane || pane.mode !== 'collapsed') return;
  event.preventDefault();
  paneReorderState = {
    sourceType: 'collapsed-pane',
    payload: { sourceType: 'collapsed-pane', paneId },
    phase: 'pressing',
    pointerId: event.pointerId,
    paneId,
    element: event.currentTarget,
    startClientX: event.clientX,
    startClientY: event.clientY,
    lastClientX: event.clientX,
    lastClientY: event.clientY,
    movedBeforeLongPress: false,
    longPressReady: false,
    originalPaneIds: workspace.state.panes.map((item) => item.id),
    provisionalPaneIds: workspace.state.panes.map((item) => item.id),
    sourcePlaceholder: null,
    previewElement: null,
    longPressTimer: window.setTimeout(() => {
      if (paneReorderState?.paneId === paneId && paneReorderState.phase === 'pressing') {
        paneReorderState.longPressReady = true;
      }
    }, PANE_REORDER_LONG_PRESS_DELAY)
  };
  try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch (_error) {}
  window.addEventListener('pointermove', handleCollapsedPanePointerMove, { passive: false });
  window.addEventListener('pointerup', handleCollapsedPanePointerUp);
  window.addEventListener('pointercancel', handleCollapsedPanePointerCancel);
}

function handleCollapsedPanePointerMove(event) {
  const state = paneReorderState;
  if (!state || event.pointerId !== state.pointerId) return;
  state.lastClientX = event.clientX;
  state.lastClientY = event.clientY;
  const distance = Math.hypot(
    event.clientX - state.startClientX,
    event.clientY - state.startClientY
  );
  if (state.phase === 'pressing') {
    if (distance <= PANE_REORDER_DRAG_THRESHOLD) return;
    event.preventDefault();
    if (!state.longPressReady) {
      state.movedBeforeLongPress = true;
      return;
    }
    beginCollapsedPaneReorder(state);
  }
  if (state.phase === 'reordering') {
    event.preventDefault();
    if (!paneReorderFrame) paneReorderFrame = window.requestAnimationFrame(applyCollapsedPaneReorderFrame);
  }
}

function handleCollapsedPanePointerUp(event) {
  const state = paneReorderState;
  if (!state || event.pointerId !== state.pointerId) return;
  state.lastClientX = event.clientX;
  state.lastClientY = event.clientY;
  if (state.phase === 'pressing') {
    const shouldExpand = !state.movedBeforeLongPress;
    clearCollapsedPaneReorder(state);
    if (shouldExpand) expandCollapsedWorkspacePane(state.paneId);
    return;
  }
  if (paneReorderFrame) applyCollapsedPaneReorderFrame();
  clearCollapsedPaneReorder(state, {
    commit: paneReorderDropIsValid(event.clientX, event.clientY)
  });
}

function handleCollapsedPanePointerCancel(event) {
  if (!paneReorderState || event.pointerId !== paneReorderState.pointerId) return;
  clearCollapsedPaneReorder(paneReorderState);
}

function handlePaneStackKeyDown(event) {
  if (event.key !== 'Escape') return;
  if (paneDividerDragState) {
    event.preventDefault();
    event.stopImmediatePropagation();
    finishPaneDividerDrag({ cancel: true });
    return;
  }
  if (paneReorderState) {
    event.preventDefault();
    event.stopImmediatePropagation();
    clearCollapsedPaneReorder(paneReorderState);
  }
}

document.addEventListener('keydown', handlePaneStackKeyDown, true);
window.addEventListener('blur', () => {
  if (paneDividerDragState) finishPaneDividerDrag({ cancel: true });
  if (paneReorderState) clearCollapsedPaneReorder(paneReorderState);
});

function markdownModeLabel(mode) {
  if (mode === markdownPageModel.MARKDOWN_MODES.SOURCE) return 'Source Mode';
  if (mode === markdownPageModel.MARKDOWN_MODES.READING) return 'Reading Mode';
  return 'Live Preview';
}

function hnTextModeLabel(mode) {
  return hnTextModel.normalizeHnTextMode(mode) === hnTextModel.HN_TEXT_MODES.BROWSER
    ? 'Browser' : 'Edit';
}

function renderSharedCountPresentation(controlStrip, statistics) {
  if (!sharedCountPresentation || !controlStrip) return;
  const zoomControls = controlStrip.querySelector('.markdown-zoom-controls');
  sharedCountPresentation.mount(controlStrip, zoomControls);
  sharedCountPresentation.update(statistics);
}

function refreshMarkdownControlStrip(runtime) {
  if (!markdownControlStrip) return;
  const markdownActive = Boolean(runtimeIsLive(runtime)
    && runtime === activePaneRuntime() && runtime.currentPage
    && markdownPageModel.normalizePageType(runtime.currentPage.type)
      === markdownPageModel.PAGE_TYPES.MARKDOWN);
  markdownControlStrip.hidden = !markdownActive;
  if (markdownActive) {
    const mode = markdownPageModel.normalizeMarkdownMode(vaultPreferences.lastMarkdownMode);
    const stats = markdownPageModel.statistics(runtime.currentPage.markdownBody || '');
    markdownModeValue.textContent = markdownModeLabel(mode);
    renderSharedCountPresentation(markdownControlStrip, stats);
    markdownZoomValueButton.textContent = `${Math.round(runtime.canvasView.scale * 100)}%`;
  }
  refreshHnTextControlStrip(runtime);
}

function refreshHnTextControlStrip(runtime, snapshot = null) {
  if (!hnTextControlStrip) return;
  const active = runtimeIsLive(runtime)
    && runtime === activePaneRuntime() && pageIsHnText(runtime.currentPage);
  hnTextControlStrip.hidden = !active;
  if (!active) return;
  const source = snapshot?.pageId === runtime.currentPage.id && typeof snapshot.source === 'string'
    ? snapshot.source
    : hnPageDocumentSessionRegistry?.get?.(runtime.currentPage.id)?.currentSnapshot?.()?.source;
  const presentationSource = typeof source === 'string'
    ? source : hnTextSourceFromEnvelope(runtime.currentPage.cneText);
  if (hnTextModeValue) {
    hnTextModeValue.textContent = hnTextModeLabel(vaultPreferences.cneTextMode);
  }
  renderSharedCountPresentation(
    hnTextControlStrip,
    globalThis.hnTextModel?.statistics?.(presentationSource)
  );
  hnTextZoomValueButton.textContent = `${Math.round(runtime.canvasView.scale * 100)}%`;
}

function refreshAllMarkdownPaneViews() {
  for (const pane of workspace.state.panes) {
    const page = pageForWorkspacePane(pane);
    if (markdownPageModel.normalizePageType(page?.type) !== markdownPageModel.PAGE_TYPES.MARKDOWN) {
      continue;
    }
    const stage = pane.viewContext?.dom?.canvasStage;
    if (!stage) continue;
    window.markdownPageView?.updateMarkdownPageLayer?.(stage, {
      mode: vaultPreferences.lastMarkdownMode
    });
  }
  refreshMarkdownControlStrip(activePaneRuntime());
}

function refreshAllHnTextPaneViews() {
  const mode = hnTextModel.normalizeHnTextMode(vaultPreferences.cneTextMode);
  for (const pane of workspace.state.panes) {
    const page = pageForWorkspacePane(pane);
    if (!pageIsHnText(page)) continue;
    const stage = pane.viewContext?.dom?.canvasStage;
    if (!stage) continue;
    globalThis.updateHnTextPageLayer?.(stage, { mode });
  }
  refreshHnTextControlStrip(activePaneRuntime());
}

function refreshMarkdownPageViews(pageId) {
  const activeRuntime = activePaneRuntime();
  saveActiveTabViewState(activeRuntime);
  for (const pane of workspace.state.panes) {
    const page = pageForWorkspacePane(pane);
    if (page?.id !== pageId
      || markdownPageModel.normalizePageType(page.type) !== markdownPageModel.PAGE_TYPES.MARKDOWN) {
      continue;
    }
    const runtime = runtimeForPane(pane);
    renderCanvas(runtime, page.objects || [], page.blocks || [], { fit: false });
  }
  restoreActiveTabViewState(activeRuntime);
  refreshMarkdownControlStrip(activeRuntime);
}

function setMarkdownPageConversionReadOnly(pageId, readOnly) {
  let updated = false;
  for (const pane of workspace.state.panes) {
    const page = pageForWorkspacePane(pane);
    if (page?.id !== pageId
      || markdownPageModel.normalizePageType(page.type) !== markdownPageModel.PAGE_TYPES.MARKDOWN) {
      continue;
    }
    const stage = pane.viewContext?.dom?.canvasStage;
    if (!stage) continue;
    window.markdownPageView?.updateMarkdownPageLayer?.(stage, {
      bodyReadOnly: Boolean(readOnly)
    });
    updated = true;
  }
  return updated;
}

function applyVaultMarkdownPreferences(value, { rerender = true } = {}) {
  const previousDefaultPageType = pageTypesModel.normalizeVaultDefaultPageType(
    vaultPreferences?.defaultPageType
  );
  vaultPreferences = {
    ...pageTypesModel.normalizeSettings(value),
    ...markdownPageModel.normalizeSettings(value),
    ...hnTextModel.normalizeSettings(value)
  };
  globalThis.document?.documentElement?.setAttribute?.(
    'data-markdown-preserve-single-line-breaks',
    String(Boolean(vaultPreferences.preserveSingleLineBreaks))
  );
  const defaultPageType = pageTypesModel.normalizeVaultDefaultPageType(
    vaultPreferences.defaultPageType
  );
  if (pageIndex
    && defaultPageType !== previousDefaultPageType
    && typeof renderPageList === 'function') {
    renderPageList({ force: true });
  }
  if (rerender) {
    refreshAllMarkdownPaneViews();
    refreshAllHnTextPaneViews();
  } else {
      const runtime = activePaneRuntime();
      refreshMarkdownControlStrip(runtime);
      refreshHnTextControlStrip(runtime);
  }
  return vaultPreferences;
}

function queueVaultMarkdownPreferenceIntent(intent) {
  const operation = markdownPreferenceSaveQueue
    .catch(() => {})
    .then(() => request('/api/vault-preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(intent.changes)
    }));
  markdownPreferenceSaveQueue = operation;
  operation.then(
    () => {
      if (pendingMarkdownPreferenceSave === intent) pendingMarkdownPreferenceSave = null;
    },
    (error) => {
      intent.error = error instanceof Error ? error : new Error(String(error));
    }
  );
  return operation;
}

function queueVaultMarkdownPreferenceSave(changes) {
  const intent = {
    changes: { ...(changes || {}) },
    error: null
  };
  pendingMarkdownPreferenceSave = intent;
  return queueVaultMarkdownPreferenceIntent(intent);
}

globalThis.queueVaultMarkdownPreferenceSave = queueVaultMarkdownPreferenceSave;
globalThis.flushMarkdownPreferenceSavesNow = async () => {
  await markdownPreferenceSaveQueue.catch(() => {});
  for (let pass = 0; pass < 2 && pendingMarkdownPreferenceSave; pass += 1) {
    const intent = pendingMarkdownPreferenceSave;
    intent.error = null;
    await queueVaultMarkdownPreferenceIntent(intent).catch(() => {});
  }
  if (!pendingMarkdownPreferenceSave) return { ok: true };
  return {
    ok: false,
    error: pendingMarkdownPreferenceSave.error?.message
      || 'Markdown preferences could not be saved.'
  };
};

function setVaultMarkdownMode(mode) {
  const normalizedMode = markdownPageModel.normalizeMarkdownMode(mode);
  const version = ++markdownModePreferenceVersion;
  applyVaultMarkdownPreferences({ ...vaultPreferences, lastMarkdownMode: normalizedMode });
  queueVaultMarkdownPreferenceSave({ lastMarkdownMode: normalizedMode })
    .then((saved) => {
      if (version !== markdownModePreferenceVersion) return;
      applyVaultMarkdownPreferences(saved, { rerender: false });
    })
    .catch((error) => {
      if (version === markdownModePreferenceVersion) {
        showRuntimeStatus(activePaneRuntime(), error.message || 'Markdown mode could not be saved.', true);
      }
    });
}

function cycleVaultMarkdownMode() {
  const modes = [
    markdownPageModel.MARKDOWN_MODES.LIVE_PREVIEW,
    markdownPageModel.MARKDOWN_MODES.SOURCE,
    markdownPageModel.MARKDOWN_MODES.READING
  ];
  const index = modes.indexOf(markdownPageModel.normalizeMarkdownMode(vaultPreferences.lastMarkdownMode));
  setVaultMarkdownMode(modes[(index + 1) % modes.length]);
}

function setVaultHnTextMode(mode) {
  const normalizedMode = hnTextModel.normalizeHnTextMode(mode);
  const version = ++hnTextModePreferenceVersion;
  applyVaultMarkdownPreferences({ ...vaultPreferences, cneTextMode: normalizedMode });
  queueVaultMarkdownPreferenceSave({ cneTextMode: normalizedMode })
    .then((saved) => {
      if (version !== hnTextModePreferenceVersion) return;
      applyVaultMarkdownPreferences(saved, { rerender: false });
    })
    .catch((error) => {
      if (version === hnTextModePreferenceVersion) {
        showRuntimeStatus(activePaneRuntime(), error.message || 'HN Text mode could not be saved.', true);
      }
    });
}

function cycleVaultHnTextMode() {
  const mode = hnTextModel.normalizeHnTextMode(vaultPreferences.cneTextMode);
  setVaultHnTextMode(mode === hnTextModel.HN_TEXT_MODES.EDIT
    ? hnTextModel.HN_TEXT_MODES.BROWSER
    : hnTextModel.HN_TEXT_MODES.EDIT);
}

function zoomActiveMarkdownBy(runtime, factor) {
  if (runtime !== activePaneRuntime()
    || markdownPageModel.normalizePageType(runtime.currentPage?.type) !== markdownPageModel.PAGE_TYPES.MARKDOWN) return;
  const rect = runtime.dom.canvasArea.getBoundingClientRect();
  zoomAtPoint(runtime, rect.left + rect.width / 2, rect.top + rect.height / 2, runtime.canvasView.scale * factor);
  saveActiveTabViewState(runtime);
  refreshMarkdownControlStrip(runtime);
}

function resetActiveMarkdownZoom(runtime) {
  if (runtime !== activePaneRuntime()
    || markdownPageModel.normalizePageType(runtime.currentPage?.type) !== markdownPageModel.PAGE_TYPES.MARKDOWN) return;
  const rect = runtime.dom.canvasArea.getBoundingClientRect();
  zoomAtPoint(runtime, rect.left + rect.width / 2, rect.top + rect.height / 2, 1);
  saveActiveTabViewState(runtime);
  refreshMarkdownControlStrip(runtime);
}

function zoomActiveHnTextBy(runtime, factor) {
  if (runtime !== activePaneRuntime() || !pageIsHnText(runtime.currentPage)) return;
  const rect = runtime.dom.canvasArea.getBoundingClientRect();
  zoomAtPoint(runtime, rect.left + rect.width / 2, rect.top + rect.height / 2, runtime.canvasView.scale * factor);
  saveActiveTabViewState(runtime);
  refreshHnTextControlStrip(runtime);
}

function resetActiveHnTextZoom(runtime) {
  if (runtime !== activePaneRuntime() || !pageIsHnText(runtime.currentPage)) return;
  const rect = runtime.dom.canvasArea.getBoundingClientRect();
  zoomAtPoint(runtime, rect.left + rect.width / 2, rect.top + rect.height / 2, 1);
  saveActiveTabViewState(runtime);
  refreshHnTextControlStrip(runtime);
}

function refreshActivePaneWindowChrome(runtime) {
  if (!runtimeIsLive(runtime) || runtime !== activePaneRuntime()) return false;
  updatePageHistoryButtons(runtime);
  if (!runtime.currentPage) {
    runtime.dom.pageTitleDisplay.textContent = '';
    runtime.dom.pageTitle.value = '';
    runtime.dom.titleForm.hidden = true;
    runtime.dom.pageTitleDisplay.hidden = false;
    renderMaintenanceResources(runtime, { objects: [], maintenanceResources: [] });
    renderExternalLinks(runtime, { externalLinks: [] });
    renderRelations(runtime, { blocks: [], backlinks: [] });
    updateEditAvailability(runtime);
    addFileButton.disabled = true;
  } else {
    runtime.dom.pageTitleDisplay.textContent = runtime.currentPage.title;
    runtime.dom.pageTitle.value = runtime.currentPage.title;
    runtime.dom.titleForm.hidden = true;
    runtime.dom.pageTitleDisplay.hidden = false;
    if (pageSupportsCanvas(runtime.currentPage)) {
      prepareActiveTabHighlightState(runtime);
      renderBlockOverlays(runtime, runtime.currentPage.blocks || []);
    }
    renderMaintenanceResources(runtime, runtime.currentPage);
    renderExternalLinks(runtime, runtime.currentPage);
    renderRelations(runtime, runtime.currentPage);
    updateEditAvailability(runtime);
    addFileButton.disabled = !pageSupportsFileImport(runtime.currentPage) || !desktopAddFileAvailable();
  }
  for (const button of pageList.querySelectorAll('.page-link')) {
    button.classList.toggle(
      'active', !navigationExplicitSelectionMode && button.dataset.pageId === runtime.currentPage?.id
    );
  }
  setPaneInfoPanelsAvailable(runtime, runtime.currentPage);
  renderInfoPanelsForRuntime?.(runtime);
  refreshMarkdownControlStrip(runtime);
  return true;
}

function setActiveWorkspacePane(paneId, { refreshChrome = true } = {}) {
  initializeWorkspacePaneModel();
  const target = getWorkspacePane(paneId);
  if (!target) return false;
  const previous = getActivePane();
  const previousRuntime = runtimeForPane(previous);
  const targetRuntime = runtimeForPane(target);
  if (!targetRuntime) return false;
  if (previous?.id !== target.id) {
    globalThis.cancelMarkdownTableInteraction?.(
      previousRuntime?.dom?.canvasStage
        || previous?.element?.querySelector?.('.markdown-page-layer')
    );
    commitFocusedMarkdownEditor();
    globalThis.clearMarkdownClipboardSelection?.({ clearBrowserSelection: true });
    if (typeof prepareInfoPanelsForRuntimeContextChange === 'function') {
      prepareInfoPanelsForRuntimeContextChange(previousRuntime);
    }
    if (previousRuntime?.blockEditMode) cancelBlockEdits(previousRuntime);
    if (previousRuntime?.pageEditMode) cancelPageEdits(previousRuntime);
    if (previousRuntime?.highlightEditDraft) cancelHighlightEdits(previousRuntime);
    closeAddLinkPopover(previousRuntime);
    closeSidebarExternalLinkEditor(previousRuntime);
    closeBlockLinkChoicePopover();
    saveActiveTabViewState(previousRuntime);
    workspace.activatePane(target.id);
  }
  for (const pane of workspace.state.panes) {
    pane.element.classList.toggle('is-workspace-pane-active', pane.id === target.id);
    if (pane.id !== target.id && pane.viewContext?.dom?.editMenu) {
      pane.viewContext.dom.editMenu.hidden = true;
      pane.viewContext.dom.editBlockButton?.setAttribute('aria-expanded', 'false');
    }
    if (pane.id !== target.id && pane.viewContext?.dom?.highlightMenu) {
      pane.viewContext.dom.highlightMenu.hidden = true;
      pane.viewContext.dom.highlightButton?.setAttribute('aria-expanded', 'false');
    }
  }
  if (refreshChrome) {
    renderTabStrip({ ensureActiveVisible: true, preserveLayoutTransition: true });
    refreshActivePaneWindowChrome(targetRuntime);
  }
  return true;
}

function resetWorkspacePanes() {
  if (tabReorderState) cancelTabReorder({ suppressClick: true, immediate: true });
  if (sidebarPageDragState) cancelSidebarPageDrag({ immediate: true });
  if (paneDividerDragState) finishPaneDividerDrag({ cancel: true });
  if (paneReorderState) clearCollapsedPaneReorder(paneReorderState);
  globalThis.clearMarkdownClipboardSelection?.({ clearBrowserSelection: true });
  workspace.state.panes.forEach((pane) => {
    const runtime = runtimeForPane(pane);
    if (runtime) {
      disposeInfoPanelsForRuntime(runtime);
      disposeCanvasRuntime(runtime);
      runtime.pageLoadSequence += 1;
      runtime.loadGeneration = runtime.pageLoadSequence;
      runtime.mounted = {
        generation: (runtime.mounted?.generation || 0) + 1,
        pageId: null,
        kind: null
      };
      runtime.lifecycleEpoch += 1;
      runtime.disposed = true;
    }
    pane.element?.querySelectorAll?.('.markdown-page-layer').forEach((layer) => {
      globalThis.destroyMarkdownPageLayer?.(layer);
    });
    globalThis.destroyHnTextPageLayer?.(runtime?.dom?.canvasStage);
    if (runtime?.dom) {
      for (const key of Object.keys(runtime.dom)) runtime.dom[key] = null;
    }
  });
  const existing = workspace.state.panes[0] || initializeWorkspacePaneModel();
  const element = existing?.element || workspacePaneRoot?.querySelector('.workspace-pane');
  const session = existing?.session || sessionTabsModel.createTabSession();
  if (element) element.dataset.workspacePaneId = 'main-pane';
  const infoPanelLayer = element?.querySelector?.('.info-panel-layer');
  if (infoPanelLayer) infoPanelLayer.dataset.paneId = 'main-pane';
  const context = createPaneViewContext('main-pane', paneDomReferences(element), session);
  const pane = workspace.reset({ id: 'main-pane', session, viewContext: context });
  pane.element = element;
  const availableWidth = workspacePaneAvailableWidth();
  if (availableWidth > 0) workspace.fitToWidth(availableWidth);
  renderWorkspacePaneLayout();
  if (typeof bindWorkspacePaneInteractions === 'function') bindWorkspacePaneInteractions(pane);
  scheduleHnSessionReferenceReconcile();
  return pane;
}

function renderPageIntoInactivePane(runtime, page, { fit = false } = {}) {
  if (!runtimeIsLive(runtime) || runtime === activePaneRuntime() || !page) return false;
  runtime.currentPage = page;
  runtime.currentPageEntry = pageIndex?.pages?.find((entry) => entry.id === page.id) || null;
  renderPageContent(runtime, page, { fit });
  if (pageSupportsCanvas(page)) {
    prepareActiveTabHighlightState(runtime);
    renderBlockOverlays(runtime, page.blocks || []);
  }
  setPaneInfoPanelsAvailable(runtime, page);
  updatePaneToolbarPresentation(getWorkspacePane(runtime.paneId));
  return true;
}

function createAllocatedWorkspacePane(session, insertionIndex) {
  initializeWorkspacePaneModel();
  const availableWidth = workspacePaneAvailableWidth();
  const pane = workspace.addPaneAllocated({ session, insertionIndex }, availableWidth);
  if (!pane) return null;
  pane.element = createPaneCanvasElement(pane.id);
  pane.viewContext.session = pane.session;
  Object.assign(pane.viewContext.dom, paneDomReferences(pane.element));
  renderWorkspacePaneLayout();
  if (typeof bindWorkspacePaneInteractions === 'function') bindWorkspacePaneInteractions(pane);
  return pane;
}

async function openPageInWorkspacePane(paneId, pageId, insertionIndex = null) {
  const pane = getWorkspacePane(paneId);
  if (!pane || !pageIndex.pages.some((page) => page.id === pageId)) return false;
  setActiveWorkspacePane(paneId, { refreshChrome: false });
  pane.session.createTab(pageId, { insertionIndex });
  renderTabStrip({ ensureActiveVisible: true });
  const pageEntry = pageIndex.pages.find((page) => page.id === pageId);
  return loadPage(runtimeForPane(pane), pageEntry, {
    historyMode: 'preserve',
    preferCanonical: true,
    saveCurrentView: false
  });
}

function tabReorderSlots(list) {
  const listRect = list.getBoundingClientRect();
  return [...list.querySelectorAll('.viewer-tab')].map((element) => {
    const rect = element.getBoundingClientRect();
    const left = rect.left - listRect.left + list.scrollLeft;
    return {
      id: element.dataset.tabId,
      element,
      left,
      right: left + rect.width,
      width: rect.width,
      center: left + (rect.width / 2)
    };
  });
}

function removeTabReorderPointerListeners() {
  window.removeEventListener('pointermove', handleTabReorderPointerMove);
  window.removeEventListener('pointerup', handleTabReorderPointerUp);
  window.removeEventListener('pointercancel', handleTabReorderPointerCancel);
}

function addTabReorderPointerListeners() {
  window.addEventListener('pointermove', handleTabReorderPointerMove, { passive: false });
  window.addEventListener('pointerup', handleTabReorderPointerUp);
  window.addEventListener('pointercancel', handleTabReorderPointerCancel);
}

function releaseTabReorderPointer(state) {
  if (!state?.element?.hasPointerCapture?.(state.pointerId)) return;
  try {
    state.element.releasePointerCapture(state.pointerId);
  } catch (_error) {
    // Pointer capture may already be gone after cancellation.
  }
}

function clearSharedPagePreviewReturnCompletion(state) {
  const preview = state?.previewElement;
  const surface = state?.previewSurface || tabPagePreviewSurface(preview);
  const tabBody = state?.previewTabBody || tabPagePreviewTabBody(preview);
  if (preview && state?.previewReturnTransitionEnd) {
    preview.removeEventListener('transitionend', state.previewReturnTransitionEnd);
  }
  if (preview && state?.previewReturnTransitionCancel) {
    preview.removeEventListener('transitioncancel', state.previewReturnTransitionCancel);
  }
  if (surface && state?.previewReturnSurfaceTransitionEnd) {
    surface.removeEventListener('transitionend', state.previewReturnSurfaceTransitionEnd);
  }
  if (surface && state?.previewReturnSurfaceTransitionCancel) {
    surface.removeEventListener('transitioncancel', state.previewReturnSurfaceTransitionCancel);
  }
  if (tabBody && state?.previewReturnTabBodyTransitionEnd) {
    tabBody.removeEventListener('transitionend', state.previewReturnTabBodyTransitionEnd);
  }
  if (tabBody && state?.previewReturnTabBodyTransitionCancel) {
    tabBody.removeEventListener('transitioncancel', state.previewReturnTabBodyTransitionCancel);
  }
  if (state?.previewReturnFallbackTimer) {
    window.clearTimeout(state.previewReturnFallbackTimer);
  }
  if (state) {
    state.previewReturnTransitionEnd = null;
    state.previewReturnTransitionCancel = null;
    state.previewReturnSurfaceTransitionEnd = null;
    state.previewReturnSurfaceTransitionCancel = null;
    state.previewReturnTabBodyTransitionEnd = null;
    state.previewReturnTabBodyTransitionCancel = null;
    state.previewReturnFallbackTimer = 0;
    state.previewReturnShellComplete = false;
    state.previewReturnSurfaceComplete = false;
    state.previewReturnTabBodyComplete = false;
    state.previewReturnComplete = false;
  }
}

function clearTabReorderSlotPresentation(state) {
  clearActiveTabDampingPresentation(state);
  for (const slot of state?.slots || []) {
    slot.element.classList.remove(
      'is-tab-reorder-dragging',
      'is-tab-reorder-displaced',
      'is-tab-detached-source',
      'is-tab-preview-contract-target',
      'is-tab-reorder-returning',
      'is-tab-return-continuity'
    );
    slot.element.style.transform = '';
    delete slot.element.dataset.reorderDivider;
  }
}

function clearTabReorderTransforms(state) {
  clearSidebarPageDropIndicators();
  clearSharedPagePreviewReturnCompletion(state);
  clearTabReorderDividerOverlays(state);
  state?.strip?.classList.remove('is-tab-reordering', 'is-tab-detached');
  const plus = state?.strip?.querySelector('.viewer-tab-add');
  if (plus) {
    plus.classList.remove('is-tab-reorder-displaced');
    plus.style.transform = '';
  }
  clearTabReorderSlotPresentation(state);
  state?.tabContractElement?.removeEventListener(
    'lostpointercapture',
    handleTabReorderLostPointerCapture
  );
  state?.tabContractElement?.remove();
  if (state) state.tabContractElement = null;
  releaseSidebarPageDragOwnership(state);
  if (state?.previewMorphTimer) window.clearTimeout(state.previewMorphTimer);
  destroySharedPagePreview(state);
  if (state?.source?.type === 'sidebar-page' && state.sidebarStripParticipationActive) {
    state.sidebarStripParticipationActive = false;
    updateTabStripLayout({
      provisionalInactiveTabCount: 0,
      provisionalTabWillBeActive: false
    });
  }
}

function cancelTabReorder({ suppressClick = false, immediate = true } = {}) {
  const state = tabReorderState;
  if (!state) return false;
  if (state.phase === 'returning') {
    finishTabReorderReturn(state);
    return true;
  }
  if (!immediate && state.phase !== 'pressing') {
    beginTabReorderReturn(state);
    return true;
  }
  tabReorderState = null;
  if (tabReorderFrame) window.cancelAnimationFrame(tabReorderFrame);
  tabReorderFrame = 0;
  removeTabReorderPointerListeners();
  if (suppressClick && state.phase !== 'pressing') {
    suppressSharedPageDragSourceClick(state, 1000);
  }
  releaseTabReorderPointer(state);
  clearTabReorderTransforms(state);
  return true;
}

function clearTabReorderDividerOverlays(state) {
  state?.reorderDividerOverlayLayer?.remove();
  if (state) {
    state.reorderDividerOverlayLayer = null;
    state.reorderDividerOverlays = null;
  }
}

function syncTabReorderDividerOverlays(state, provisionalOrder) {
  if (!state?.strip?.isConnected || !state.list?.isConnected) {
    clearTabReorderDividerOverlays(state);
    return;
  }
  let layer = state.reorderDividerOverlayLayer;
  if (!layer?.isConnected) {
    layer = document.createElement('div');
    layer.className = 'tab-reorder-divider-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.append(layer);
    state.reorderDividerOverlayLayer = layer;
    state.reorderDividerOverlays = new Map();
  }
  const stripRect = state.strip.getBoundingClientRect();
  const listRect = state.list.getBoundingClientRect();
  Object.assign(layer.style, {
    left: `${stripRect.left}px`,
    top: `${stripRect.top}px`,
    width: `${stripRect.width}px`,
    height: `${stripRect.height}px`
  });
  const visibleIds = new Set();
  let cursor = Number(state.slots[0]?.left) || 0;
  for (const slot of provisionalOrder) {
    const targetLeft = cursor;
    cursor += Math.max(0, Number(slot.width) || 0);
    if (slot.id === state.tabId || slot.element.dataset.reorderDivider !== 'true') continue;
    visibleIds.add(slot.id);
    let divider = state.reorderDividerOverlays.get(slot.id);
    if (!divider) {
      divider = document.createElement('span');
      divider.className = 'tab-reorder-divider-overlay';
      layer.append(divider);
      state.reorderDividerOverlays.set(slot.id, divider);
    }
    const originalRight = listRect.left - state.list.scrollLeft + slot.left + slot.width;
    divider.style.left = `${originalRight - stripRect.left - 1}px`;
    divider.style.transform = `translate3d(${targetLeft - slot.left}px, 0, 0)`;
  }
  for (const [id, divider] of state.reorderDividerOverlays) {
    if (visibleIds.has(id)) continue;
    divider.remove();
    state.reorderDividerOverlays.delete(id);
  }
}

function updateTabReorderDividerOwnership(state, ordered = null) {
  const provisionalOrder = ordered || tabStripLayoutModel.reorderSequence(
    state.slots,
    state.originIndex,
    state.provisionalIndex
  );
  const included = new Set(provisionalOrder.map((slot) => slot.id));
  for (const slot of state.slots) {
    if (!included.has(slot.id)) slot.element.dataset.reorderDivider = 'false';
  }
  for (let index = 0; index < provisionalOrder.length; index += 1) {
    const slot = provisionalOrder[index];
    const visible = slot.element.dataset.active !== 'true';
    slot.element.dataset.reorderDivider = String(visible);
  }
  const draggedSlot = provisionalOrder.find((slot) => slot.id === state.tabId);
  if (state.previewElement) {
    state.previewElement.dataset.reorderDivider = draggedSlot?.element.dataset.reorderDivider || 'false';
  }
  syncTabReorderDividerOverlays(state, provisionalOrder);
}

function positionTabPagePreview(state) {
  positionSharedPagePreview(state);
}

function freezeTabPagePreviewSurface(state) {
  const preview = state?.previewElement;
  const surface = state?.previewSurface || tabPagePreviewSurface(preview);
  if (!preview || !surface || preview.hidden) return;
  const surfaceRect = surface.getBoundingClientRect();
  const previewRect = preview.getBoundingClientRect();
  const size = tabPagePreviewSize(preview);
  clearTabPreviewMorph(state);
  preview.style.transform = `translate3d(${previewRect.left}px, ${previewRect.top}px, 0)`;
  state.previewLeft = previewRect.left;
  state.previewTop = previewRect.top;
  surface.style.transformOrigin = '0 0';
  surface.style.transform = `translate3d(${surfaceRect.left - previewRect.left}px, ${surfaceRect.top - previewRect.top}px, 0) scale3d(${surfaceRect.width / size.width}, ${surfaceRect.height / size.height}, 1)`;
}

function clearTabPreviewMorph(state) {
  if (state?.previewMorphTimer) window.clearTimeout(state.previewMorphTimer);
  if (state) state.previewMorphTimer = 0;
  state?.previewElement?.classList.remove('is-unfolding');
}

function applyDetachedSourceGap(state) {
  const offsets = tabStripLayoutModel.detachedOffsets(state.slots, state.tabId);
  for (const slot of state.stationaryTabs) {
    const offset = offsets.get(slot.id) || 0;
    slot.element.style.transform = Math.abs(offset) > 0.01
      ? `translate3d(${offset}px, 0, 0)`
      : 'translate3d(0, 0, 0)';
  }
  const plus = state.strip.querySelector('.viewer-tab-add');
  if (plus) {
    plus.classList.add('is-tab-reorder-displaced');
    plus.style.transform = `translate3d(${-state.draggedSlot.width}px, 0, 0)`;
  }
  updateTabReorderDividerOwnership(
    state,
    state.slots.filter((slot) => slot.id !== state.tabId)
  );
}

function clearSidebarProspectiveTabStripParticipation(state) {
  if (state?.source?.type !== 'sidebar-page'
    || state.sidebarStripParticipationActive === false) return false;
  const oldRects = new Map((state.stationaryTabs || []).map((slot) => [
    slot.id,
    slot.element.getBoundingClientRect()
  ]));
  const plus = state.strip?.querySelector('.viewer-tab-add');
  const oldPlusRect = plus?.getBoundingClientRect() || null;
  if (tabStripLayoutFrame) window.cancelAnimationFrame(tabStripLayoutFrame);
  tabStripLayoutFrame = 0;
  clearTabReorderDividerOverlays(state);
  state.strip?.classList.remove('is-tab-reordering');
  clearTabReorderSlotPresentation(state);
  for (const slot of state.stationaryTabs || []) {
    slot.element.style.opacity = '';
    slot.element.style.visibility = '';
    slot.element.style.width = '';
    slot.element.style.minWidth = '';
    slot.element.style.maxWidth = '';
    slot.element.style.flex = '';
    const title = slot.element.querySelector('.viewer-tab-title');
    if (title) {
      title.style.opacity = '';
      title.style.visibility = '';
    }
  }
  if (plus) {
    plus.classList.remove('is-tab-reorder-displaced');
    plus.style.transform = '';
  }
  state.sidebarStripParticipationActive = false;
  settleTabStripGeometry(oldRects, {
    oldPlusRect,
    layoutOptions: {
      provisionalInactiveTabCount: 0,
      provisionalTabWillBeActive: false
    }
  });
  state.slots = [...(state.stationaryTabs || [])];
  state.draggedSlot = null;
  state.provisionalSlotRects = null;
  state.originIndex = -1;
  state.provisionalIndex = -1;
  return true;
}

function restoreSidebarProspectiveTabStripParticipation(state, target) {
  if (state?.source?.type !== 'sidebar-page') return true;
  const list = target?.list;
  const strip = target?.element;
  const contractTarget = state.tabContractElement;
  if (!list?.isConnected || !strip?.isConnected || !contractTarget?.isConnected) return false;
  clearTabReorderSettleAnimation();
  if (tabStripLayoutFrame) window.cancelAnimationFrame(tabStripLayoutFrame);
  tabStripLayoutFrame = 0;
  const provisionalSizing = updateTabStripLayout({
    provisionalInactiveTabCount: 1,
    provisionalTabWillBeActive: true
  });
  const stationaryTabs = tabReorderSlots(list);
  const width = Math.max(
    tabStripLayoutModel.MINIMUM_INACTIVE_TAB_WIDTH,
    provisionalSizing?.provisionalTabWidth
      || tabStripLayoutModel.PREFERRED_TAB_WIDTH
  );
  const listRect = list.getBoundingClientRect();
  const pointerContentX = state.lastClientX - listRect.left + list.scrollLeft;
  const originIndex = tabStripLayoutModel.insertionIndexAtPoint(
    stationaryTabs,
    pointerContentX
  );
  const firstLeft = stationaryTabs[0]?.left || 0;
  const virtualLeft = originIndex < stationaryTabs.length
    ? stationaryTabs[originIndex].left
    : stationaryTabs.at(-1)?.right || firstLeft;
  const stripRect = strip.getBoundingClientRect();
  Object.assign(contractTarget.style, {
    top: `${stripRect.top}px`,
    left: `${listRect.left - list.scrollLeft + virtualLeft}px`,
    width: `${width}px`,
    minWidth: `${width}px`,
    maxWidth: `${width}px`,
    height: `${stripRect.height}px`,
    transform: 'translate3d(0, 0, 0)'
  });
  const draggedSlot = {
    id: state.tabId,
    left: virtualLeft,
    right: virtualLeft + width,
    width,
    element: contractTarget
  };
  const slots = [...stationaryTabs];
  slots.splice(originIndex, 0, draggedSlot);
  state.element = contractTarget;
  state.list = list;
  state.strip = strip;
  state.currentTargetStripId = target.stripId;
  state.originalTabOrder = slots.map((slot) => slot.id);
  state.slots = slots;
  state.draggedSlot = draggedSlot;
  state.originIndex = originIndex;
  state.provisionalIndex = originIndex;
  state.stationaryTabs = stationaryTabs;
  state.provisionalSlotRects = tabStripLayoutModel.provisionalSlotRects(
    slots,
    state.tabId,
    originIndex
  );
  state.grabOffsetX = width * state.grabRatioX;
  state.originalTabRect = contractTarget.getBoundingClientRect();
  state.lastDraggedLeft = virtualLeft;
  state.needsInitialPlacement = true;
  state.dragX = 0;
  state.forceTabLayout = true;
  state.sidebarStripParticipationActive = true;
  strip.classList.add('is-tab-reordering');
  for (const slot of stationaryTabs) slot.element.classList.add('is-tab-reorder-displaced');
  return true;
}

function detachTabReorder(state) {
  if (state.phase !== 'reordering') return false;
  if (tabReorderFrame) window.cancelAnimationFrame(tabReorderFrame);
  tabReorderFrame = 0;
  applyTabReorderVisuals();
  const previewRect = state.previewElement?.getBoundingClientRect();
  const activeTabBody = state.previewTabActive
    ? (state.previewTabBody || tabPagePreviewTabBody(state.previewElement))
    : null;
  const activeTabBodyRect = activeTabBody?.getBoundingClientRect();
  state.detachDampedY = activeTabBodyRect && previewRect
    ? Math.max(0, activeTabBodyRect.top - previewRect.top)
    : 0;
  const liveTabRect = activeTabBodyRect
    || previewRect
    || state.element.getBoundingClientRect();
  clearActiveTabDampingPresentation(state);
  clearTabPreviewMorph(state);
  state.phase = 'detached-preview';
  clearSidebarPageDropIndicators();
  state.currentTargetStripId = null;
  state.detachedAtClientY = state.lastClientY;
  state.previewReentryArmed = !hitTestTabStrip(state.lastClientX, state.lastClientY);
  state.strip.classList.add('is-tab-detached');
  if (state.source?.type === 'sidebar-page') {
    clearSidebarProspectiveTabStripParticipation(state);
  } else {
    applyDetachedSourceGap(state);
  }
  state.element.classList.remove('is-tab-reorder-dragging', 'is-tab-preview-contract-target');
  state.element.classList.add('is-tab-detached-source');
  state.element.style.transform = '';
  showSharedPagePreviewInPageMode(state, liveTabRect);
  return true;
}

function enterTabStripFromPreview(state, target) {
  if (state.phase !== 'detached-preview'
    || !state.previewReentryArmed
    || target.stripId !== state.sourceStripId) return false;
  clearSidebarPageDropIndicators();
  state.phase = 'reordering';
  state.currentTargetStripId = target.stripId;
  state.gestureIntent = 'horizontal-reorder';
  state.peelY = 0;
  state.peelTargetY = 0;
  if (!restoreSidebarProspectiveTabStripParticipation(state, target)) {
    state.phase = 'detached-preview';
    state.currentTargetStripId = null;
    return false;
  }
  state.strip.classList.remove('is-tab-detached');
  state.element.classList.remove('is-tab-detached-source');
  state.element.classList.add('is-tab-reorder-dragging', 'is-tab-preview-contract-target');
  const plus = state.strip.querySelector('.viewer-tab-add');
  if (plus) {
    plus.classList.remove('is-tab-reorder-displaced');
    plus.style.transform = 'translate3d(0, 0, 0)';
  }
  const listRect = state.list.getBoundingClientRect();
  const pointerContentX = state.lastClientX - listRect.left + state.list.scrollLeft;
  const firstLeft = state.slots[0]?.left || 0;
  const lastRight = state.slots[state.slots.length - 1]?.right || firstLeft;
  const maximumLeft = Math.max(firstLeft, lastRight - state.draggedSlot.width);
  const nextLeft = Math.min(
    Math.max(firstLeft, pointerContentX - state.grabOffsetX),
    maximumLeft
  );
  state.lastDraggedLeft = nextLeft;
  state.needsInitialPlacement = true;
  state.forceTabLayout = true;
  showSharedPagePreviewInTabMode(state, state.element.getBoundingClientRect());
  applyTabReorderVisuals();
  return true;
}

function currentStationaryTabSlotGeometry(state) {
  const slotStart = Number(state?.slots?.[0]?.left);
  const stationaryStart = Number(state?.stationaryTabs?.[0]?.left);
  let cursor = Number.isFinite(slotStart)
    ? slotStart
    : Number.isFinite(stationaryStart) ? stationaryStart : 0;
  return (state?.stationaryTabs || []).map((slot) => {
    const width = Math.max(0, Number(slot.width) || 0);
    const rect = {
      id: slot.id,
      left: cursor,
      right: cursor + width,
      width,
      center: cursor + (width / 2)
    };
    cursor += width;
    return rect;
  });
}

function applySharedTabSortingVisuals(state, peelY = 0) {
  if (!state?.list?.isConnected || !state.element?.isConnected) return false;
  const listRect = state.list.getBoundingClientRect();
  const pointerX = Math.min(Math.max(state.lastClientX, listRect.left), listRect.right);
  const pointerContentX = pointerX - listRect.left + state.list.scrollLeft;
  const firstLeft = state.slots[0]?.left || 0;
  const lastRight = state.slots[state.slots.length - 1]?.right || firstLeft;
  const maximumLeft = Math.max(firstLeft, lastRight - state.draggedSlot.width);
  const draggedLeft = Math.min(
    Math.max(firstLeft, pointerContentX - state.grabOffsetX),
    maximumLeft
  );
  const dragX = draggedLeft - state.draggedSlot.left;
  const insertionIndex = state.needsInitialPlacement
    ? tabStripLayoutModel.insertionIndexAtPoint(
      currentStationaryTabSlotGeometry(state),
      pointerContentX
    )
    : tabStripLayoutModel.nextInsertionIndex({
      slots: state.slots,
      draggedId: state.tabId,
      insertionIndex: state.provisionalIndex,
      draggedLeft,
      previousDraggedLeft: state.lastDraggedLeft,
      tolerance: 1
    });

  const shellPeelY = state.previewTabActive ? 0 : peelY;
  state.element.style.transform = `translate3d(${dragX}px, ${shellPeelY}px, 0)`;
  state.dragX = dragX;
  state.lastDraggedLeft = draggedLeft;
  state.needsInitialPlacement = false;
  const insertionChanged = insertionIndex !== state.provisionalIndex;
  if (!insertionChanged && !state.forceTabLayout) return false;
  state.provisionalIndex = insertionIndex;
  state.forceTabLayout = false;
  state.provisionalSlotRects = tabStripLayoutModel.provisionalSlotRects(
    state.slots,
    state.tabId,
    insertionIndex
  );
  const offsets = tabStripLayoutModel.targetOffsets(state.slots, state.tabId, insertionIndex);
  for (const slot of state.slots) {
    if (slot.id === state.tabId) continue;
    const offset = offsets.get(slot.id) || 0;
    slot.element.style.transform = Math.abs(offset) > 0.01
      ? `translate3d(${offset}px, 0, 0)`
      : 'translate3d(0, 0, 0)';
  }
  updateTabReorderDividerOwnership(state);
  return insertionChanged;
}

function applySharedTabSortingPreview(state, peelY = 0) {
  const insertionChanged = applySharedTabSortingVisuals(state, peelY);
  updateActiveTabDampingPresentation(state, peelY);
  if (state?.previewElement && !state.previewElement.hidden) {
    positionSharedTabModePreview(state);
  }
  return insertionChanged;
}

function applyTabReorderVisuals() {
  tabReorderFrame = 0;
  const state = tabReorderState;
  if (!state || !state.list.isConnected || state.phase === 'returning') return;
  if (state.phase === 'detached-preview') {
    positionTabPagePreview(state);
    updateSharedPageDropTarget(state);
    return;
  }
  if (state.phase !== 'reordering') return;
  const peelTarget = tabPeelTarget(state);
  state.peelTargetY = peelTarget;
  const peelDifference = peelTarget - state.peelY;
  state.peelY = Math.abs(peelDifference) < 0.1
    ? peelTarget
    : state.peelY + peelDifference * 0.55;
  applySharedTabSortingPreview(state, state.peelY);
  const peelStillMoving = Math.abs(state.peelTargetY - state.peelY) >= 0.1;
  if (peelStillMoving) scheduleTabReorderVisuals();
}

function scheduleTabReorderVisuals() {
  if (tabReorderFrame) return;
  tabReorderFrame = window.requestAnimationFrame(applyTabReorderVisuals);
}

function beginTabReorder(state, event) {
  if (state.phase !== 'pressing') return;
  state.phase = 'reordering';
  clearTabTitleTooltip();
  state.strip.classList.add('is-tab-reordering');
  state.element.classList.add('is-tab-reorder-dragging', 'is-tab-preview-contract-target');
  for (const slot of state.stationaryTabs) slot.element.classList.add('is-tab-reorder-displaced');
  updateTabReorderDividerOwnership(state);
  showSharedPagePreviewInTabMode(state, state.originalTabRect);
  try {
    state.element.setPointerCapture?.(state.pointerId);
  } catch (_error) {
    // Window listeners remain as a safe fallback when capture is unavailable.
  }
  event.preventDefault();
}

function updateTabGestureIntent(state) {
  const dx = state.lastClientX - state.startClientX;
  const dy = state.lastClientY - state.startClientY;
  const tabHeight = Math.max(1, state.originalTabRect.height);
  if (state.gestureIntent === 'downward-detach'
    && dy <= Math.max(4, tabHeight * 0.1)) {
    state.gestureIntent = 'undecided';
  }
  if (state.gestureIntent !== 'undecided') return state.gestureIntent;
  const directIntentDistance = Math.max(10, tabHeight * 0.25);
  const horizontalIntentDistance = Math.max(TAB_REORDER_DRAG_THRESHOLD, tabHeight * 0.12);
  if (dy > directIntentDistance && dy > Math.abs(dx) * 1.3) {
    state.gestureIntent = 'downward-detach';
  } else if (Math.abs(dx) > horizontalIntentDistance
    && Math.abs(dx) > Math.abs(dy) * 1.2) {
    state.gestureIntent = 'horizontal-reorder';
  }
  return state.gestureIntent;
}

function tabPeelTarget(state) {
  const downwardDistance = Math.max(0, state.lastClientY - state.startClientY);
  if (state.gestureIntent === 'downward-detach') {
    return Math.min(12, downwardDistance * 0.45);
  }
  if (state.gestureIntent === 'horizontal-reorder') {
    return Math.min(7, downwardDistance * 0.18);
  }
  return Math.min(8, downwardDistance * 0.3);
}

function pointerExceedsTabDetachThreshold(state) {
  const rect = state.strip.getBoundingClientRect();
  if (state.lastClientY <= state.startClientY) return false;
  if (state.gestureIntent === 'downward-detach') {
    const directDetachDistance = Math.max(14, rect.height * 0.35);
    return state.lastClientY - state.startClientY > directDetachDistance;
  }
  if (state.gestureIntent === 'horizontal-reorder') {
    const reorderDetachDistance = Math.max(28, rect.height * 0.75);
    return state.lastClientY > rect.bottom + reorderDetachDistance;
  }
  return false;
}

function tabReorderCommitDecision(state) {
  if (state?.phase !== 'reordering') {
    return { canCommit: false, reason: 'not-reordering', target: null };
  }
  if (!state.strip?.isConnected || !state.list?.isConnected) {
    return { canCommit: false, reason: 'missing-strip-or-list', target: null };
  }
  const target = getRegisteredTabStrips().find((candidate) => (
    candidate.stripId === state.currentTargetStripId
    && candidate.element === state.strip
    && candidate.list === state.list
  ));
  if (!target) return { canCommit: false, reason: 'unknown-strip', target: null };
  const maximumIndex = state.stationaryTabs?.length ?? -1;
  if (!Number.isInteger(state.provisionalIndex)
    || state.provisionalIndex < 0
    || state.provisionalIndex > maximumIndex) {
    return { canCommit: false, reason: 'invalid-provisional-index', target: null };
  }
  return {
    canCommit: true,
    reason: 'valid-reorder-state',
    target: { kind: 'tab-strip', ...target, insertionIndex: state.provisionalIndex }
  };
}

function handleTabReorderPointerMove(event) {
  const state = tabReorderState;
  if (!state || event.pointerId !== state.pointerId) return;
  state.lastClientX = event.clientX;
  state.lastClientY = event.clientY;
  if (state.phase === 'pressing') {
    if (Math.hypot(
      event.clientX - state.startClientX,
      event.clientY - state.startClientY
    ) < TAB_REORDER_DRAG_THRESHOLD) return;
    beginTabReorder(state, event);
  }
  if (state.phase === 'reordering') {
    updateTabGestureIntent(state);
  }
  if (state.phase === 'reordering'
    && pointerExceedsTabDetachThreshold(state)) {
    detachTabReorder(state);
  } else if (state.phase === 'detached-preview') {
    const stripBounds = state.strip.getBoundingClientRect();
    if (!state.previewReentryArmed && (
      !hitTestTabStrip(event.clientX, event.clientY)
      || event.clientY <= state.detachedAtClientY - Math.max(8, stripBounds.height * 0.2)
    )) state.previewReentryArmed = true;
    const target = state.previewReentryArmed
      ? hitTestTabStripInterior(event.clientX, event.clientY)
      : null;
    if (target) enterTabStripFromPreview(state, target);
  }
  event.preventDefault();
  scheduleTabReorderVisuals();
}

function liveOriginalTabRect(state) {
  state.element.style.transform = '';
  let listRect = state.list.getBoundingClientRect();
  let tabRect = state.element.getBoundingClientRect();
  if (tabRect.left < listRect.left) {
    state.list.scrollLeft -= listRect.left - tabRect.left;
  } else if (tabRect.right > listRect.right) {
    state.list.scrollLeft += tabRect.right - listRect.right;
  }
  listRect = state.list.getBoundingClientRect();
  tabRect = state.element.getBoundingClientRect();
  return {
    left: Math.max(listRect.left, Math.min(tabRect.left, listRect.right - tabRect.width)),
    top: tabRect.top,
    width: tabRect.width,
    height: tabRect.height
  };
}

function finishTabReorderReturn(state) {
  if (tabReorderState !== state || state.returnCleanupComplete) return;
  state.returnCleanupComplete = true;
  clearSharedPagePreviewReturnCompletion(state);
  tabReorderState = null;
  clearTabReorderTransforms(state);
  scheduleTabStripLayout({ ensureActiveVisible: true });
}

function showActiveTabReturnContinuity(state) {
  if (state?.source?.type !== 'tab' || !state.previewTabActive) return false;
  if (!state.element?.isConnected || state.element.dataset.active !== 'true') return false;
  state.element.classList.add('is-tab-return-continuity');
  return true;
}

function beginTabReorderReturn(state) {
  if (!state || state.phase === 'returning') return;
  state.phase = 'returning';
  clearSidebarPageDropIndicators();
  if (tabReorderFrame) window.cancelAnimationFrame(tabReorderFrame);
  tabReorderFrame = 0;
  removeTabReorderPointerListeners();
  suppressSharedPageDragSourceClick(state, 1000);
  releaseTabReorderPointer(state);
  const target = resolveSharedPageDragReturnTarget(state);
  state.element.classList.remove('is-tab-reorder-dragging');
  state.element.classList.add('is-tab-reorder-returning');
  state.element.style.transform = 'translate3d(0, 0, 0)';
  showActiveTabReturnContinuity(state);
  for (const slot of state.stationaryTabs) slot.element.style.transform = 'translate3d(0, 0, 0)';
  const plus = state.strip.querySelector('.viewer-tab-add');
  if (plus) plus.style.transform = 'translate3d(0, 0, 0)';
  updateTabReorderDividerOwnership(state, state.slots);
  animateSharedPagePreviewReturn(state, target, {
    isCurrent: () => tabReorderState === state,
    onFinish: () => finishTabReorderReturn(state)
  });
}

function setTabSettleWidth(element, width) {
  const value = `${Math.max(0, Number(width) || 0)}px`;
  element.style.flexBasis = value;
  element.style.width = value;
  element.style.minWidth = value;
  element.style.maxWidth = value;
}

function clearTabSettleWidth(element) {
  element.style.flexBasis = '';
  element.style.width = '';
  element.style.minWidth = '';
  element.style.maxWidth = '';
}

function captureTabStripLayoutState() {
  const strip = activePaneTabStrip();
  const list = strip?.querySelector('.viewer-tab-list');
  if (!strip || !list) return null;
  const tabs = new Map();
  for (const element of list.querySelectorAll('.viewer-tab')) {
    const tabId = element.dataset.tabId;
    if (!tabId) continue;
    tabs.set(tabId, {
      id: tabId,
      rect: element.getBoundingClientRect(),
      opacity: window.getComputedStyle(element).opacity,
      visual: element.cloneNode(true)
    });
  }
  return {
    tabs,
    plusRect: strip.querySelector('.viewer-tab-add')?.getBoundingClientRect() || null
  };
}

function createClosingTabVisual(snapshot) {
  if (!snapshot?.visual || !snapshot.rect) return null;
  const visual = snapshot.visual;
  visual.classList.remove(
    'is-tab-inserting',
    'is-tab-reorder-dragging',
    'is-tab-reorder-displaced',
    'is-tab-reorder-flip',
    'is-tab-reorder-settling'
  );
  visual.classList.add('is-tab-closing-visual');
  visual.setAttribute('aria-hidden', 'true');
  visual.style.setProperty('--tab-closing-start-opacity', snapshot.opacity || '1');
  visual.style.left = `${snapshot.rect.left}px`;
  visual.style.top = `${snapshot.rect.top}px`;
  visual.style.height = `${snapshot.rect.height}px`;
  setTabSettleWidth(visual, snapshot.rect.width);
  for (const control of visual.querySelectorAll('button, [tabindex]')) {
    control.tabIndex = -1;
  }
  document.body.append(visual);
  tabStripClosingVisuals.add(visual);
  return visual;
}

function settleTabStripGeometry(oldRects, {
  oldPlusRect = null,
  layoutOptions = {},
  enteringTabIds = [],
  enteringFromRect = null,
  exitingTabs = []
} = {}) {
  const strip = activePaneTabStrip();
  const list = strip?.querySelector('.viewer-tab-list');
  if (!strip || !list) return false;
  clearTabReorderSettleAnimation();
  if (tabStripLayoutFrame) window.cancelAnimationFrame(tabStripLayoutFrame);
  tabStripLayoutFrame = 0;
  const elements = [...list.querySelectorAll('.viewer-tab')];
  for (const element of elements) {
    element.classList.remove('is-tab-reorder-dragging', 'is-tab-reorder-displaced');
    delete element.dataset.reorderDivider;
    element.classList.add('is-tab-reorder-flip');
    element.style.transform = '';
    clearTabSettleWidth(element);
  }
  const plus = strip.querySelector('.viewer-tab-add');
  plus?.classList.remove(
    'is-tab-layout-transitioning',
    'is-tab-reorder-displaced',
    'is-tab-reorder-settling'
  );
  plus?.classList.add('is-tab-reorder-flip');
  if (plus) {
    plus.style.left = '';
    plus.style.transform = '';
  }
  updateTabStripLayout(layoutOptions);
  const finalRects = new Map(elements.map((element) => [
    element.dataset.tabId,
    element.getBoundingClientRect()
  ]));
  const finalPlusRect = plus?.getBoundingClientRect() || null;
  const finalListRect = list.getBoundingClientRect();
  const plusOffset = oldPlusRect && finalPlusRect
    ? oldPlusRect.left - finalPlusRect.left
    : 0;
  const animatePlus = Boolean(plus && oldPlusRect && finalPlusRect
    && Math.abs(plusOffset) > 0.01);
  if (animatePlus) {
    plus.classList.add('is-tab-layout-transitioning');
    plus.style.left = `${finalPlusRect.left - finalListRect.left + list.scrollLeft}px`;
  }
  const enteringIds = new Set(enteringTabIds);
  const enteringElements = new Set(elements.filter((element) => (
    enteringIds.has(element.dataset.tabId)
  )));
  for (const element of elements) {
    const previous = oldRects.get(element.dataset.tabId);
    const final = finalRects.get(element.dataset.tabId);
    if (previous && final && Math.abs(previous.width - final.width) > 0.01) {
      setTabSettleWidth(element, previous.width);
    } else if (enteringElements.has(element) && final) {
      element.classList.add('is-tab-inserting');
      setTabSettleWidth(element, 0);
    }
  }
  const initialLayoutRects = new Map(elements.map((element) => [
    element.dataset.tabId,
    element.getBoundingClientRect()
  ]));
  for (const element of elements) {
    const previous = oldRects.get(element.dataset.tabId);
    const initial = initialLayoutRects.get(element.dataset.tabId);
    const offset = previous && initial
      ? previous.left - initial.left
      : (enteringElements.has(element) && Number.isFinite(enteringFromRect?.left) && initial
        ? enteringFromRect.left - initial.left
        : 0);
    element.style.transform = Math.abs(offset) > 0.01
      ? `translate3d(${offset}px, 0, 0)`
      : '';
  }
  if (plus) {
    plus.style.transform = Math.abs(plusOffset) > 0.01
      ? `translate3d(${plusOffset}px, 0, 0)`
      : '';
  }
  const closingVisuals = exitingTabs.map(createClosingTabVisual).filter(Boolean);
  list.getBoundingClientRect();
  if (animatePlus) window.getComputedStyle(plus).transform;
  tabReorderSettleFrame = window.requestAnimationFrame(() => {
    tabReorderSettleFrame = 0;
    for (const element of elements) {
      if (!element.isConnected) continue;
      element.classList.remove('is-tab-reorder-flip');
      element.classList.add('is-tab-reorder-settling');
      const final = finalRects.get(element.dataset.tabId);
      if (final) setTabSettleWidth(element, final.width);
      element.style.transform = 'translate3d(0, 0, 0)';
    }
    if (plus?.isConnected) {
      plus.classList.remove('is-tab-reorder-flip');
      plus.classList.add('is-tab-reorder-settling');
      plus.style.transform = 'translate3d(0, 0, 0)';
    }
    for (const visual of closingVisuals) {
      if (visual.isConnected) visual.classList.add('is-tab-reorder-settling');
    }
    tabReorderSettleTimer = window.setTimeout(() => {
      tabReorderSettleTimer = 0;
      for (const element of elements) {
        element.classList.remove('is-tab-inserting', 'is-tab-reorder-settling');
        element.style.transform = '';
        clearTabSettleWidth(element);
        delete element.dataset.reorderDivider;
      }
      plus?.classList.remove('is-tab-layout-transitioning', 'is-tab-reorder-settling');
      if (plus) {
        plus.style.left = '';
        plus.style.transform = '';
      }
      for (const visual of closingVisuals) {
        visual.remove();
        tabStripClosingVisuals.delete(visual);
      }
      if (list.isConnected) ensureActiveTabVisible(list);
    }, TAB_REORDER_SETTLE_DURATION);
  });
  return true;
}

function animateTabStripLayoutChange(change, {
  ensureActiveVisible = true,
  layoutOptions = {}
} = {}) {
  if (typeof change !== 'function') return null;
  const before = captureTabStripLayoutState();
  const result = change();
  renderTabStrip({ ensureActiveVisible });
  if (!before) return result;
  const strip = activePaneTabStrip();
  const list = strip?.querySelector('.viewer-tab-list');
  if (!list) return result;
  const finalIds = new Set([...list.querySelectorAll('.viewer-tab')]
    .map((element) => element.dataset.tabId));
  const oldRects = new Map([...before.tabs].map(([tabId, snapshot]) => [
    tabId,
    snapshot.rect
  ]));
  const enteringTabIds = [...finalIds].filter((tabId) => !before.tabs.has(tabId));
  const exitingTabs = [...before.tabs]
    .filter(([tabId]) => !finalIds.has(tabId))
    .map(([, snapshot]) => snapshot);
  settleTabStripGeometry(oldRects, {
    oldPlusRect: before.plusRect,
    layoutOptions: { ...layoutOptions, ensureActiveVisible },
    enteringTabIds,
    enteringFromRect: before.plusRect,
    exitingTabs
  });
  return result;
}

function settleCommittedTabReorder(oldRects) {
  settleTabStripGeometry(oldRects);
}

function commitTabReorder(state) {
  if (tabReorderFrame) window.cancelAnimationFrame(tabReorderFrame);
  tabReorderFrame = 0;
  applyTabReorderVisuals();
  state.phase = 'committing';
  clearSidebarPageDropIndicators();
  const { pageTitle: draggedPageTitle } = state;
  const oldRects = new Map(state.slots.map((slot) => [
    slot.id,
    slot.element.getBoundingClientRect()
  ]));
  removeTabReorderPointerListeners();
  releaseTabReorderPointer(state);
  state.strip.classList.remove('is-tab-reordering', 'is-tab-detached');
  const plus = state.strip.querySelector('.viewer-tab-add');
  if (plus) {
    plus.classList.remove('is-tab-reorder-displaced');
    plus.style.transform = '';
  }
  clearTabReorderDividerOverlays(state);
  clearTabReorderSlotPresentation(state);
  suppressNextTabClick(state.tabId);
  const runtime = runtimeForPane(state.source?.paneId);
  if (!runtime) return beginTabReorderReturn(state);
  runtime.session.reorderTab(state.tabId, state.provisionalIndex);
  renderTabStrip({ preserveDragState: true });
  const tabElement = state.list.querySelector(
    `.viewer-tab[data-tab-id="${CSS.escape(state.tabId)}"]`
  );
  if (tabElement && draggedPageTitle) applyTabTitlePresentation(tabElement, draggedPageTitle);
  destroySharedPagePreview(state);
  tabReorderState = null;
  settleCommittedTabReorder(oldRects);
}

async function commitSidebarTabReorder(state) {
  if (tabReorderFrame) window.cancelAnimationFrame(tabReorderFrame);
  tabReorderFrame = 0;
  applyTabReorderVisuals();
  state.phase = 'committing';
  clearSidebarPageDropIndicators();
  const insertionIndex = state.provisionalIndex;
  const { pageId, pageTitle: draggedPageTitle } = state;
  const oldRects = new Map(state.stationaryTabs.map((slot) => [
    slot.id,
    slot.element.getBoundingClientRect()
  ]));
  removeTabReorderPointerListeners();
  state.tabContractElement?.removeEventListener(
    'lostpointercapture',
    handleTabReorderLostPointerCapture
  );
  releaseTabReorderPointer(state);
  state.strip.classList.remove('is-tab-reordering', 'is-tab-detached');
  const plus = state.strip.querySelector('.viewer-tab-add');
  if (plus) {
    plus.classList.remove('is-tab-reorder-displaced');
    plus.style.transform = '';
  }
  clearTabReorderDividerOverlays(state);
  clearTabReorderSlotPresentation(state);
  state.tabContractElement?.remove();
  state.tabContractElement = null;
  state.sidebarStripParticipationActive = false;
  suppressSharedPageDragSourceClick(state, 1000);
  tabReorderState = null;
  updateTabStripLayout({
    provisionalInactiveTabCount: 0,
    provisionalTabWillBeActive: false
  });
  let previewCleaned = false;
  const finishAfterTabRender = () => {
    if (previewCleaned) return;
    previewCleaned = true;
    destroySharedPagePreview(state);
    settleCommittedTabReorder(oldRects);
  };
  const existing = workspaceTabForPageInPane(getActivePane()?.id, pageId);
  if (existing) {
    finishAfterTabRender();
    return activateWorkspaceTab(existing);
  }
  const result = await openPageInNewTab(activePaneRuntime(), pageId, {
    insertionIndex,
    pageTitle: draggedPageTitle,
    onTabRendered: finishAfterTabRender
  });
  finishAfterTabRender();
  return result;
}

function handleTabReorderPointerUp(event) {
  const state = tabReorderState;
  if (!state || event.pointerId !== state.pointerId) return;
  state.lastClientX = event.clientX;
  state.lastClientY = event.clientY;
  if (state.phase === 'pressing') {
    tabReorderState = null;
    removeTabReorderPointerListeners();
    destroySharedPagePreview(state);
    return;
  }
  event.preventDefault();
  if (state.phase === 'reordering') {
    updateTabGestureIntent(state);
    if (pointerExceedsTabDetachThreshold(state)) detachTabReorder(state);
  }
  if (state.phase === 'detached-preview' && state.previewReentryArmed) {
    const interiorTarget = hitTestTabStripInterior(event.clientX, event.clientY);
    if (interiorTarget) enterTabStripFromPreview(state, interiorTarget);
  }
  const decision = tabReorderCommitDecision(state);
  state.releaseDecisionReason = decision.reason;
  if (decision.canCommit) {
    commitSharedPageDrag(state, decision.target);
  } else if (state.phase === 'detached-preview') {
    const target = hitTestSharedPageDropTarget(state, event.clientX, event.clientY);
    if (target?.kind === 'pane-edge') commitSharedPageDrag(state, target);
    else beginTabReorderReturn(state);
  } else {
    beginTabReorderReturn(state);
  }
}

function handleTabReorderPointerCancel(event) {
  if (!tabReorderState || event.pointerId !== tabReorderState.pointerId) return;
  cancelTabReorder({ suppressClick: true, immediate: false });
}

function handleTabReorderLostPointerCapture(event) {
  if (!tabReorderState || ['returning', 'committing'].includes(tabReorderState.phase)
    || event.pointerId !== tabReorderState.pointerId) return;
  cancelTabReorder({ suppressClick: true, immediate: false });
}

function handleTabReorderKeyDown(event) {
  if (event.key !== 'Escape' || !tabReorderState || tabReorderState.phase === 'pressing') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  cancelTabReorder({ suppressClick: true, immediate: false });
}

function handleTabReorderPointerDown(event, element) {
  if (event.button !== 0 || event.isPrimary === false || tabReorderState
    || sidebarPageDragState) return;
  if (event.target.closest('.viewer-tab-close')) return;
  const list = element.closest('.viewer-tab-list');
  const strip = element.closest('.viewer-tab-strip');
  if (!list || !strip) return;
  clearTabReorderSettleAnimation();
  clearTabTitleTooltip();
  const slots = tabReorderSlots(list);
  const originIndex = slots.findIndex((slot) => slot.id === element.dataset.tabId);
  if (originIndex < 0) return;
  const listRect = list.getBoundingClientRect();
  const pointerContentX = event.clientX - listRect.left + list.scrollLeft;
  const draggedSlot = slots[originIndex];
  const originalTabRect = element.getBoundingClientRect();
  const runtime = runtimeForPane(strip.dataset.ownerPaneId);
  const tab = runtime?.session.tabById(element.dataset.tabId);
  if (!tab) return;
  tabReorderState = beginSharedPageDrag({
    event,
    pageId: tab.currentPageId,
    source: {
      type: 'tab',
      commitMode: 'move-existing-tab',
      originRect: originalTabRect,
      pageId: tab.currentPageId,
      tabId: tab.id,
      paneId: strip.dataset.ownerPaneId || 'main-pane',
      element
    },
    state: {
      sourceType: 'tab-page',
      phase: 'pressing',
      commitMode: 'move-existing-tab',
      gestureIntent: 'undecided',
      tabId: element.dataset.tabId,
      draggedTabId: element.dataset.tabId,
      sourceStripId: strip.dataset.tabStripId || tabStripIdForPane(getActivePane()?.id),
      sourceIndex: originIndex,
      sourceActiveTabId: activeTab(runtime)?.id || null,
      currentTargetStripId: strip.dataset.tabStripId || tabStripIdForPane(getActivePane()?.id),
      originalTabOrder: slots.map((slot) => slot.id),
      element,
      list,
      strip,
      slots,
      draggedSlot,
      originIndex,
      provisionalIndex: originIndex,
      stationaryTabs: slots.filter((slot) => slot.id !== element.dataset.tabId),
      provisionalSlotRects: tabStripLayoutModel.provisionalSlotRects(
        slots,
        element.dataset.tabId,
        originIndex
      ),
      grabOffsetX: pointerContentX - draggedSlot.left,
      originalTabRect,
      previewTabActive: element.dataset.active === 'true',
      previewReentryArmed: false,
      detachedAtClientY: null,
      returnCleanupComplete: false,
      dragX: 0,
      peelY: 0,
      peelTargetY: 0,
      needsInitialPlacement: false,
      lastDraggedLeft: draggedSlot.left
    }
  });
  addTabReorderPointerListeners();
}

document.addEventListener('keydown', handleTabReorderKeyDown, true);
window.addEventListener('blur', () => {
  if (tabReorderState && tabReorderState.phase !== 'pressing'
    && tabReorderState.phase !== 'returning') {
    cancelTabReorder({ suppressClick: true, immediate: false });
  }
});

function createTabElement(tab, paneId) {
  const element = document.createElement('div');
  element.className = 'viewer-tab';
  element.dataset.tabId = tab.id;
  element.dataset.paneId = paneId;
  element.setAttribute('role', 'tab');

  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'viewer-tab-title';
  title.addEventListener('click', (event) => {
    if (consumeSuppressedTabClick(element.dataset.tabId)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    clearTabTitleTooltip();
    if (getActivePane()?.id !== paneId) setActiveWorkspacePane(paneId);
    switchToTab(element.dataset.tabId, paneId);
  });

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'viewer-tab-close';
  close.append(createViewerChromeIcon('close'));
  close.setAttribute('aria-label', 'Close Tab');
  close.addEventListener('pointerdown', (event) => event.stopPropagation());
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    clearTabTitleTooltip();
    closeTab(element.dataset.tabId, paneId);
  });
  element.addEventListener('pointerenter', () => scheduleTabTitleTooltip(element));
  element.addEventListener('pointerleave', clearTabTitleTooltip);
  element.addEventListener('pointerdown', (event) => {
    if (getActivePane()?.id !== paneId) setActiveWorkspacePane(paneId);
    handleTabReorderPointerDown(event, element);
  });
  element.addEventListener('lostpointercapture', handleTabReorderLostPointerCapture);
  element.append(title, close);
  return element;
}

function ensurePaneTabCollection() {
  let collection = topTabArea?.querySelector('.workspace-pane-tab-collection');
  if (collection) return collection;
  collection = document.createElement('div');
  collection.className = 'workspace-pane-tab-collection';
  topTabArea?.replaceChildren(collection);
  return collection;
}

function renderPaneTabStrip(pane, {
  ensureActiveVisible = false,
  preserveLeftAnchor = false,
  preserveTitlePresentation = false
} = {}) {
  const collection = ensurePaneTabCollection();
  let region = paneTabRegion(pane.id);
  if (!region) {
    region = document.createElement('div');
    region.className = 'workspace-pane-tab-region';
    region.dataset.workspacePaneId = pane.id;
  }
  region.classList.toggle('is-workspace-pane-active', pane.id === workspace.state.activePaneId);
  region.classList.toggle('is-workspace-pane-collapsed', pane.mode === 'collapsed');
  region.classList.toggle(
    'is-pane-reorder-source',
    paneReorderState?.phase === 'reordering' && pane.id === paneReorderState.paneId
  );
  collection.append(region);
  if (pane.mode === 'collapsed') {
    region.replaceChildren();
    return;
  }
  let strip = region.querySelector('.viewer-tab-strip');
  if (!strip) {
    strip = document.createElement('div');
    strip.className = 'viewer-tab-strip';
    region.append(strip);
  }
  strip.dataset.ownerPaneId = pane.id;
  strip.dataset.tabStripId = tabStripIdForPane(pane.id);
  let list = strip.querySelector('.viewer-tab-list');
  if (!list) {
    list = document.createElement('div');
    list.className = 'viewer-tab-list';
    list.setAttribute('role', 'tablist');
    list.addEventListener('wheel', clearTabTitleTooltip, { passive: true });
    list.addEventListener('scroll', clearTabTitleTooltip, { passive: true });
    strip.prepend(list);
  }
  observeTabStrip(strip);
  const tabs = pane.session.tabs();
  const validIds = new Set(tabs.map((tab) => tab.id));
  for (const element of list.querySelectorAll('.viewer-tab')) {
    if (!validIds.has(element.dataset.tabId)) element.remove();
  }
  let plus = strip.querySelector('.viewer-tab-add');
  if (!plus) {
    plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'viewer-tab-add';
    plus.append(createViewerChromeIcon('add'));
    plus.setAttribute('aria-label', 'New Tab');
    plus.addEventListener('click', () => {
      clearTabTitleTooltip();
      setActiveWorkspacePane(pane.id);
      createEmptyTab(pane.id);
    });
  }
  for (const tab of tabs) {
    let element = list.querySelector(`.viewer-tab[data-tab-id="${CSS.escape(tab.id)}"]`);
    if (!element) element = createTabElement(tab, pane.id);
    const title = pageTitleForTab(tab);
    if (!preserveTitlePresentation) applyTabTitlePresentation(element, title);
    const selected = tab.id === pane.session.activeTab()?.id;
    element.dataset.active = String(selected);
    element.setAttribute('aria-selected', String(selected));
    element.tabIndex = selected ? 0 : -1;
    list.append(element);
  }
  list.append(plus);
  let menu = strip.querySelector('.viewer-tab-menu');
  if (!menu) {
    menu = document.createElement('button');
    menu.type = 'button';
    menu.className = 'viewer-tab-menu';
    menu.setAttribute('aria-label', 'Show Open Tabs');
    menu.setAttribute('aria-haspopup', 'menu');
    const chevron = createViewerChromeIcon('tab-menu', 'viewer-tab-menu-chevron');
    menu.append(chevron);
    menu.addEventListener('click', (event) => openTabListMenu(event, pane.id));
  }
  strip.append(menu);
  updateTabStripLayout({
    paneId: pane.id,
    ensureActiveVisible: ensureActiveVisible && pane.id === workspace.state.activePaneId,
    smooth: ensureActiveVisible && pane.id === workspace.state.activePaneId,
    preserveLeftAnchor,
    preserveTitlePresentation
  });
}

function renderTabStrip({
  ensureActiveVisible = false,
  preserveDragState = false,
  preserveLayoutTransition = false,
  preserveLeftAnchor = false,
  preserveTitlePresentation = false
} = {}) {
  if (!topTabArea) return;
  if (tabReorderState && !preserveDragState) cancelTabReorder({ suppressClick: true });
  if (!preserveLayoutTransition) clearTabReorderSettleAnimation();
  clearTabTitleTooltip();
  const collection = ensurePaneTabCollection();
  const validPaneIds = new Set(workspace.state.panes.map((pane) => pane.id));
  for (const region of collection.querySelectorAll('.workspace-pane-tab-region')) {
    if (!validPaneIds.has(region.dataset.workspacePaneId)) region.remove();
  }
  for (const pane of workspacePanesInRenderOrder()) {
    renderPaneTabStrip(pane, {
      ensureActiveVisible,
      preserveLeftAnchor,
      preserveTitlePresentation
    });
  }
  renderPaneToolbarCollection();
  applyWorkspacePaneGeometry();
  scheduleWorkspacePaneChromeLayout();
}

function structuredTextFrameOnlyPageChange(previous, next) {
  if (!previous || !next || previous.id !== next.id || previous.type !== next.type) return false;
  if (!pageTypesModel.pageTypeSupports(next.type, 'structured-text')) return false;
  const withoutFrameMetadata = (value) => {
    const { textFrame: _textFrame, updatedAt: _updatedAt, ...record } = value;
    return record;
  };
  return JSON.stringify(previous.textFrame) !== JSON.stringify(next.textFrame)
    && JSON.stringify(withoutFrameMetadata(previous))
      === JSON.stringify(withoutFrameMetadata(next));
}

function updateStructuredTextPageLayerForRuntime(runtime, page) {
  const stage = runtime?.dom?.canvasStage;
  if (!stage || !page) return false;
  if (pageIsHnText(page)) {
    return Boolean(globalThis.updateHnTextPageLayer?.(stage, {
      page,
      mode: hnTextModel.normalizeHnTextMode(vaultPreferences.cneTextMode)
    }));
  }
  if (markdownPageModel.normalizePageType(page.type) === markdownPageModel.PAGE_TYPES.MARKDOWN) {
    return Boolean(globalThis.markdownPageView?.updateMarkdownPageLayer?.(stage, { page }));
  }
  return false;
}

function cloneDescriptorMetadataValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function monotonicPageUpdatedAt(existingValue, incomingValue) {
  const existingTime = Date.parse(existingValue || '');
  const incomingTime = Date.parse(incomingValue || '');
  if (Number.isFinite(incomingTime)
    && (!Number.isFinite(existingTime) || incomingTime > existingTime)) {
    return incomingValue;
  }
  return existingValue;
}

function pageIndexForDescriptorMetadataInstall(incomingPageIndex, changeSet, context) {
  const incoming = cloneDescriptorMetadataValue(incomingPageIndex);
  const initialSnapshot = changeSet.snapshot && context.source === 'startup';
  if (initialSnapshot || !Array.isArray(pageIndex?.pages)) return incoming;
  const existingById = new Map(pageIndex.pages
    .filter((entry) => entry?.id)
    .map((entry) => [entry.id, entry]));
  incoming.pages = incoming.pages.map((entry) => {
    const existing = existingById.get(entry?.id);
    if (!existing) return entry;
    const merged = { ...existing };
    for (const field of ['descriptors', 'descriptorIds']) {
      if (Object.hasOwn(entry, field)) merged[field] = entry[field];
      else delete merged[field];
    }
    const updatedAt = monotonicPageUpdatedAt(existing.updatedAt, entry.updatedAt);
    if (updatedAt === undefined) delete merged.updatedAt;
    else merged.updatedAt = updatedAt;
    return merged;
  });
  return incoming;
}

function pageFromDescriptorMetadataProjection(projectionPage, existing) {
  const merged = { ...existing };
  for (const field of ['descriptors', 'ignoredDescriptors', 'ignoredManualEntryIds']) {
    merged[field] = cloneDescriptorMetadataValue(projectionPage[field]);
  }
  const updatedAt = monotonicPageUpdatedAt(existing.updatedAt, projectionPage.updatedAt);
  if (updatedAt === undefined) delete merged.updatedAt;
  else merged.updatedAt = updatedAt;
  return merged;
}

function pageForDescriptorMetadataInstall(incomingPage, projectionPage, existingPage = null) {
  const basePage = existingPage || canonicalPages.get(incomingPage.id) || incomingPage;
  return pageFromDescriptorMetadataProjection(projectionPage, basePage);
}

function adoptCategoryCommandPages(pages, { originRuntime = null } = {}) {
  const categoryPages = Array.isArray(pages) ? pages.filter((page) => page?.id) : [];
  if (!categoryPages.length) return [];
  const byId = new Map(categoryPages.map((page) => [page.id, page]));
  pageIndex = {
    ...pageIndex,
    pages: pageIndex.pages.map((entry) => {
      const saved = byId.get(entry.id);
      if (!saved) return entry;
      const merged = { ...entry };
      if (Array.isArray(saved.categories)) {
        const categories = cloneDescriptorMetadataValue(saved.categories);
        merged.categories = categories;
        merged.categoryIds = categories.map((category) => (
          typeof category === 'string' ? category : category?.id
        )).filter((categoryId) => typeof categoryId === 'string');
      }
      const updatedAt = monotonicPageUpdatedAt(entry.updatedAt, saved.updatedAt);
      if (updatedAt === undefined) delete merged.updatedAt;
      else merged.updatedAt = updatedAt;
      return merged;
    })
  };
  return categoryPages.map((saved) => {
    const previous = canonicalPages.get(saved.id);
    const merged = previous ? { ...previous } : { ...saved };
    if (Array.isArray(saved.categories)) {
      merged.categories = cloneDescriptorMetadataValue(saved.categories);
    }
    const updatedAt = monotonicPageUpdatedAt(previous?.updatedAt, saved.updatedAt);
    if (updatedAt === undefined) delete merged.updatedAt;
    else merged.updatedAt = updatedAt;
    return commitCanonicalPage(merged, {
      originRuntime,
      invalidateLinkedPages: false,
      preserveDocumentBody: true,
      presentationErrorsAreNonFatal: true
    });
  });
}

function descriptorGroupDraftIsDirty() {
  return Boolean(
    pageMetaModal?.type === 'descriptor'
    && originalDescriptorGroupsConfig
    && JSON.stringify(originalDescriptorGroupsConfig) !== JSON.stringify(descriptorGroupsConfig)
  );
}

function runDescriptorMetadataPresentation(callback) {
  try {
    return callback();
  } catch (error) {
    console.warn('[descriptor-metadata:presentation]', error);
    return undefined;
  }
}

function notifyCanonicalPageDeleted(pageId, changeSet, context) {
  if (typeof globalThis.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return;
  globalThis.dispatchEvent(new CustomEvent('canonical-page-deleted', {
    detail: {
      pageId,
      source: 'descriptor-metadata',
      deliverySource: context.source || null,
      metadataRevision: changeSet.metadataRevision
    }
  }));
}

function fenceRuntimeForCanonicalPageDeletion(runtime, pageId) {
  if (!runtimeIsLive(runtime)) return false;
  const displayAffected = runtime.currentPage?.id === pageId
    || runtime.session.activeTab()?.currentPageId === pageId;
  const matchingTabs = runtime.session.tabs()
    .filter((tab) => tab.currentPageId === pageId);
  if (!matchingTabs.length && runtime.currentPage?.id !== pageId) return false;
  if (displayAffected) {
    runtime.pageLoadSequence += 1;
    runtime.loadGeneration = runtime.pageLoadSequence;
    runtime.mounted = {
      generation: (runtime.mounted?.generation || 0) + 1,
      pageId: null,
      kind: null
    };
  }
  for (const tab of matchingTabs) runtime.session.closeTab(tab.id);
  return { displayAffected };
}

async function settleRuntimeAfterCanonicalPageDeletion(runtime, pageId) {
  const fenced = fenceRuntimeForCanonicalPageDeletion(runtime, pageId);
  if (!fenced) return false;
  if (!fenced.displayAffected) return true;
  const tab = runtime.session.activeTab();
  const fallbackEntry = tab?.currentPageId
    ? pageIndex?.pages?.find((entry) => entry.id === tab.currentPageId) || null
    : null;
  if (fallbackEntry) {
    const loaded = await loadPage(runtime, fallbackEntry, {
      historyMode: 'preserve',
      preferCanonical: true,
      saveCurrentView: false
    });
    if (loaded || !runtimeIsLive(runtime) || runtime.currentPage?.id !== pageId) return loaded;
    renderEmptyTab(runtime, 'The replacement Page could not be loaded.');
    return false;
  }
  renderEmptyTab(runtime, tab?.currentPageId
    ? 'This Page is no longer available.'
    : 'No pages are available.');
  return true;
}

function handleCanonicalPageDeleted(event) {
  const pageId = event?.detail?.pageId;
  if (event?.detail?.source !== 'descriptor-metadata'
    || typeof pageId !== 'string'
    || !pageId
    || canonicalPages.has(pageId)
    || pageIndex?.pages?.some((entry) => entry.id === pageId)) return;
  if (pageMetaModal?.runtime?.currentPage?.id === pageId) closePageMetaModal();
  const settlements = livingPaneRuntimes()
    .map((runtime) => settleRuntimeAfterCanonicalPageDeletion(runtime, pageId));
  renderTabStrip({ ensureActiveVisible: true, preserveLayoutTransition: true });
  void Promise.allSettled(settlements).then(() => {
    const runtime = activePaneRuntime();
    if (runtime) refreshActivePaneWindowChrome(runtime);
    scheduleWorkspaceStateSave();
    scheduleHnSessionReferenceReconcile();
  });
}

globalThis.addEventListener?.('canonical-page-deleted', handleCanonicalPageDeleted);

function applyDescriptorMetadataChangeSet(changeSet, context = {}) {
  const rawPresentationEvent = context.event || {};
  const preserveDescriptorGroupDraft = descriptorGroupDraftIsDirty()
    && !Object.hasOwn(rawPresentationEvent, 'descriptorGroups');
  const descriptorGroupDraft = preserveDescriptorGroupDraft
    ? descriptorGroupsConfig
    : null;
  const locallyKnownPageIds = new Set([
    ...(pageIndex?.pages || []).map((page) => page?.id).filter(Boolean),
    ...canonicalPages.keys()
  ]);
  const cumulativePageIds = new Set(
    changeSet.pageMetadataProjection.pages.map((page) => page.id)
  );
  const cumulativeDeletedPageIds = new Set(changeSet.deletedPageIds);
  for (const page of pageIndex?.pages || []) {
    if (page?.id && !cumulativePageIds.has(page.id)) cumulativeDeletedPageIds.add(page.id);
  }
  for (const pageId of canonicalPages.keys()) {
    if (!cumulativePageIds.has(pageId)) cumulativeDeletedPageIds.add(pageId);
  }

  const stagedPageIndex = pageIndexForDescriptorMetadataInstall(
    changeSet.pageIndex,
    changeSet,
    context
  );
  const stagedDescriptorLibrary = cloneDescriptorMetadataValue(changeSet.descriptorRegistry);
  const stagedVocabularyLibrary = changeSet.vocabulary === undefined
    ? undefined
    : cloneDescriptorMetadataValue(changeSet.vocabulary);
  const stagedDescriptorGroupsConfig = changeSet.descriptorGroups === undefined
    ? undefined
    : cloneDescriptorMetadataValue(changeSet.descriptorGroups);
  const projectionByPageId = new Map(
    changeSet.pageMetadataProjection.pages.map((page) => [page.id, page])
  );
  const stagedPageById = new Map();
  for (const projectionPage of changeSet.pageMetadataProjection.pages) {
    const existing = canonicalPages.get(projectionPage.id);
    if (!existing) continue;
    stagedPageById.set(
      projectionPage.id,
      pageFromDescriptorMetadataProjection(projectionPage, existing)
    );
  }
  for (const page of changeSet.pages.map((item) => cloneDescriptorMetadataValue(item))) {
    const projectionPage = projectionByPageId.get(page.id);
    const existing = stagedPageById.get(page.id) || canonicalPages.get(page.id) || null;
    stagedPageById.set(
      page.id,
      pageForDescriptorMetadataInstall(page, projectionPage, existing)
    );
  }
  const stagedPages = [...stagedPageById.values()];

  pageIndex = stagedPageIndex;
  descriptorLibrary = stagedDescriptorLibrary;
  if (stagedVocabularyLibrary !== undefined) {
    vocabularyLibrary = stagedVocabularyLibrary;
  }
  if (stagedDescriptorGroupsConfig !== undefined) {
    const committedGroups = stagedDescriptorGroupsConfig;
    if (pageMetaModal?.type === 'descriptor') {
      originalDescriptorGroupsConfig = cloneDescriptorMetadataValue(committedGroups);
    }
    descriptorGroupsConfig = preserveDescriptorGroupDraft
      ? descriptorGroupDraft
      : committedGroups;
  }
  const presentationEvent = context.source === 'dictionary-event'
    ? dictionaryEventWithRecordedRemaps(rawPresentationEvent)
    : rawPresentationEvent;

  const installedPageIds = new Set();
  const linkedPageIdsToInvalidate = new Set();
  for (const page of stagedPages) {
    const canonical = commitCanonicalPage(page, {
      originRuntime: null,
      invalidateLinkedPages: false,
      linkedPageIdsToInvalidate,
      preserveDocumentBody: true,
      presentationErrorsAreNonFatal: true
    });
    installedPageIds.add(canonical.id);
  }
  for (const targetPageId of linkedPageIdsToInvalidate) {
    if (!installedPageIds.has(targetPageId)) canonicalPages.delete(targetPageId);
  }
  const deletedPageIdsForLifecycle = [];
  for (const deletedPageId of cumulativeDeletedPageIds) {
    discardPagePersistenceState(deletedPageId);
    if (locallyKnownPageIds.has(deletedPageId)) {
      deletedPageIdsForLifecycle.push(deletedPageId);
    }
  }
  for (const deletedPageId of deletedPageIdsForLifecycle) {
    runDescriptorMetadataPresentation(() => {
      notifyCanonicalPageDeleted(deletedPageId, changeSet, context);
    });
  }

  for (const runtime of livingPaneRuntimes()) {
    const activePageId = runtime.session.activeTab()?.currentPageId;
    if (installedPageIds.has(activePageId)) {
      runtime.currentPage = canonicalPages.get(activePageId);
    }
  }
  const activeRuntime = activePaneRuntime();
  if (activeRuntime) {
    activeRuntime.currentPageEntry = activeRuntime.currentPage
      ? pageIndex.pages.find((page) => page.id === activeRuntime.currentPage.id) || null
      : null;
  }

  staleIgnoredDescriptorKeys = null;
  const modalRuntime = pageMetaModal?.runtime || activeRuntime;
  if (descriptorDraft && modalRuntime?.currentPage && installedPageIds.has(modalRuntime.currentPage.id)
    && !descriptorDraftDirty) {
    descriptorDraft = pageDescriptorDraftForRuntime(modalRuntime);
    ignoredDescriptorDraft = pageIgnoredDescriptorDraftForRuntime(modalRuntime);
    ignoredManualEntryIdsDraft = pageIgnoredManualEntryIdsDraftForRuntime(modalRuntime);
  }
  if (descriptorDraft) {
    runDescriptorMetadataPresentation(() => {
      reconcileDescriptorModalDraftsFromDictionaryEvent(presentationEvent);
    });
  }

  if (context.render === false) return;
  runDescriptorMetadataPresentation(() => renderDescriptorSearchPanel());
  runDescriptorMetadataPresentation(() => renderPageList());
  runDescriptorMetadataPresentation(() => {
    if (activeRuntime) {
      renderRelations(activeRuntime, activeRuntime.currentPage || { blocks: [], backlinks: [] });
    }
  });
  if (pageMetaModal?.type === 'descriptor') {
    runDescriptorMetadataPresentation(() => {
      rerenderDescriptorEditor(null, { preserveInputs: true });
    });
  }
}

function commitCanonicalPage(page, options = {}) {
  if (!page?.id) return page;
  const {
    originRuntime = null,
    invalidateLinkedPages = true,
    linkedPageIdsToInvalidate = null,
    preserveDocumentBody = false,
    presentationErrorsAreNonFatal = false
  } = options;
  const previous = canonicalPages.get(page.id);
  const enteringHnText = Boolean(previous && !pageIsHnText(previous) && pageIsHnText(page));
  const markdownSaveState = markdownBodySaveStates.get(page.id);
  if (preserveDocumentBody
    && previous
    && markdownPageModel.normalizePageType(page.type) === markdownPageModel.PAGE_TYPES.MARKDOWN) {
    page = { ...page, markdownBody: previous.markdownBody || '' };
  } else if (markdownPageModel.normalizePageType(page.type) === markdownPageModel.PAGE_TYPES.MARKDOWN
    && previous
    && markdownSaveState
    && (previous.markdownBody || '') !== markdownSaveState.savedBody) {
    page = { ...page, markdownBody: previous.markdownBody || '' };
  }
  const hnSession = hnPageDocumentSessionRegistry?.get?.(page.id);
  if (pageIsHnText(page) && hnSession) {
    page = {
      ...page,
      cneText: hnSession.currentEnvelope()
    };
  } else if (preserveDocumentBody && previous && pageIsHnText(page)) {
    page = { ...page, cneText: previous.cneText };
  }
  const frameOnlyChange = structuredTextFrameOnlyPageChange(previous, page);
  const linkedPageIds = (value) => new Set((value?.blocks || [])
    .flatMap((block) => block.links || [])
    .filter((link) => link.targetType === 'page' && typeof link.targetPageId === 'string')
    .map((link) => link.targetPageId));
  const pageLinkSignature = (value) => JSON.stringify((value?.blocks || [])
    .flatMap((block) => (block.links || []).map((link) => ({ blockId: block.id, ...link })))
    .filter((link) => link.targetType === 'page')
    .sort((left, right) => String(left.id).localeCompare(String(right.id))));
  const previousTargets = linkedPageIds(previous);
  const nextTargets = linkedPageIds(page);
  const previousBlockIds = new Set((previous?.blocks || []).map((block) => block.id));
  const nextBlockIds = new Set((page.blocks || []).map((block) => block.id));
  const previousHighlightIds = new Set((previous?.highlightGroups || []).map((group) => group.id));
  const nextHighlightIds = new Set((page.highlightGroups || []).map((group) => group.id));
  if (pageLinkSignature(previous) !== pageLinkSignature(page)) {
    for (const targetPageId of new Set([...previousTargets, ...nextTargets])) {
      if (targetPageId === page.id) continue;
      if (invalidateLinkedPages) canonicalPages.delete(targetPageId);
      else linkedPageIdsToInvalidate?.add(targetPageId);
    }
  }
  canonicalPages.set(page.id, page);
  const present = presentationErrorsAreNonFatal
    ? runDescriptorMetadataPresentation
    : (callback) => callback();
  present(() => renderTabStrip({ preserveLayoutTransition: true }));
  for (const runtime of livingPaneRuntimes()) {
    if (runtime.session.activeTab()?.currentPageId !== page.id) continue;
    runtime.currentPage = page;
    runtime.currentPageEntry = pageIndex?.pages?.find((entry) => entry.id === page.id) || null;
    if (runtime === originRuntime) continue;
    const structuredTextUpdate = !enteringHnText && (
      pageIsHnText(page)
      || markdownPageModel.normalizePageType(page.type) === markdownPageModel.PAGE_TYPES.MARKDOWN
    );
    if (structuredTextUpdate) {
      const updated = present(() => updateStructuredTextPageLayerForRuntime(runtime, page));
      if (updated) {
        present(() => {
          setPaneInfoPanelsAvailable(runtime, page);
          updatePaneToolbarPresentation(getWorkspacePane(runtime.paneId));
          if (runtime === activePaneRuntime()) refreshActivePaneWindowChrome(runtime);
        });
        continue;
      }
    }
    if (preserveDocumentBody && structuredTextUpdate) {
      present(() => {
        setPaneInfoPanelsAvailable(runtime, page);
        updatePaneToolbarPresentation(getWorkspacePane(runtime.paneId));
        if (runtime === activePaneRuntime()) refreshActivePaneWindowChrome(runtime);
      });
      continue;
    }
    if (frameOnlyChange) {
      const updated = present(() => updateStructuredTextPageLayerForRuntime(runtime, page));
      if (updated) continue;
    }
    present(() => {
      renderPageContent(runtime, page, { fit: false });
      if (pageSupportsCanvas(page)) {
        prepareActiveTabHighlightState(runtime);
        renderBlockOverlays(runtime, page.blocks || []);
      }
      setPaneInfoPanelsAvailable(runtime, page);
      updatePaneToolbarPresentation(getWorkspacePane(runtime.paneId));
      if (runtime === activePaneRuntime()) refreshActivePaneWindowChrome(runtime);
    });
  }
  if (typeof pruneInfoPanelsForDeletedOwner === 'function') {
    present(() => {
      for (const blockId of previousBlockIds) {
        if (!nextBlockIds.has(blockId)) pruneInfoPanelsForDeletedOwner(page.id, 'block', blockId);
      }
      for (const groupId of previousHighlightIds) {
        if (!nextHighlightIds.has(groupId)) {
          pruneInfoPanelsForDeletedOwner(page.id, 'highlight', groupId);
        }
      }
    });
  }
  return page;
}

function highlightBlockIds(group) {
  const ids = group?.blockIds || group?.blocks || [];
  return Array.isArray(ids)
    ? ids.map((item) => typeof item === 'string' ? item : item?.id).filter(Boolean)
    : [];
}

function checkedHighlightGroupIdsForViewState(viewState) {
  const explicit = Array.isArray(viewState?.checkedHighlightGroupIds)
    ? viewState.checkedHighlightGroupIds
    : [];
  const legacy = viewState?.highlightDisplayState?.enabled
    && typeof viewState?.activeHighlightGroupId === 'string'
    ? [viewState.activeHighlightGroupId]
    : [];
  return [...new Set([...explicit, ...legacy]
    .filter((groupId) => typeof groupId === 'string' && groupId))];
}

function setCheckedHighlightGroupIdsForViewState(viewState, groupIds) {
  if (!viewState) return [];
  const checked = [...new Set((Array.isArray(groupIds) ? groupIds : [])
    .filter((groupId) => typeof groupId === 'string' && groupId))];
  viewState.checkedHighlightGroupIds = checked;
  viewState.activeHighlightGroupId = checked[0] || null;
  viewState.highlightDisplayState = {
    enabled: checked.length > 0,
    dimmed: checked.length > 0
  };
  return checked;
}

function captureActiveTabViewState(runtime) {
  const tab = activeTab(runtime);
  if (!tab) return null;
  return {
    panX: runtime.canvasView.offsetX,
    panY: runtime.canvasView.offsetY,
    zoom: runtime.canvasView.scale,
    viewportInitialized: Boolean(runtime.currentPage && pageWorldIsRenderable(runtime)),
    checkedHighlightGroupIds: checkedHighlightGroupIdsForViewState(tab.viewState),
    activeHighlightGroupId: runtime.activeHighlightGroupId,
    highlightDisplayState: {
      enabled: runtime.blockVisualMode === BLOCK_MODE.HIGHLIGHT_VIEW,
      dimmed: runtime.blockVisualMode === BLOCK_MODE.HIGHLIGHT_VIEW
    },
    markdownStructuralFolds: Array.isArray(tab.viewState.markdownStructuralFolds)
      ? tab.viewState.markdownStructuralFolds.map((fold) => ({ ...fold }))
      : [],
    infoPanels: Array.isArray(tab.viewState.infoPanels)
      ? tab.viewState.infoPanels.map((panel) => ({ ...panel }))
      : [],
    infoPanelZCounter: Number(tab.viewState.infoPanelZCounter) || 0
  };
}

function saveActiveTabViewState(runtime = activePaneRuntime()) {
  if (!runtimeIsLive(runtime)) return;
  const tab = activeTab(runtime);
  const viewState = captureActiveTabViewState(runtime);
  if (tab && viewState) runtime.session.saveViewState(tab.id, viewState);
}

function prepareActiveTabHighlightState(runtime) {
  const tab = activeTab(runtime);
  runtime.activeHighlightBlockIds.clear();
  const groups = Array.isArray(runtime.currentPage?.highlightGroups)
    ? runtime.currentPage.highlightGroups : [];
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const checkedGroupIds = checkedHighlightGroupIdsForViewState(tab?.viewState)
    .filter((groupId) => groupById.has(groupId));
  if (tab) setCheckedHighlightGroupIdsForViewState(tab.viewState, checkedGroupIds);
  runtime.activeHighlightGroupId = checkedGroupIds[0] || null;
  for (const groupId of checkedGroupIds) {
    for (const blockId of highlightBlockIds(groupById.get(groupId))) {
      runtime.activeHighlightBlockIds.add(blockId);
    }
  }
  if (!runtime.blockEditMode && !runtime.pageEditMode && !runtime.highlightEditDraft) {
    runtime.blockVisualMode = checkedGroupIds.length
      ? BLOCK_MODE.HIGHLIGHT_VIEW
      : BLOCK_MODE.NORMAL;
  }
}

function restoreActiveTabViewState(runtime) {
  const tab = activeTab(runtime);
  if (!tab) return;
  prepareActiveTabHighlightState(runtime);
  if (tab.viewState.viewportInitialized && pageWorldIsRenderable(runtime)) {
    runtime.canvasView.offsetX = tab.viewState.panX;
    runtime.canvasView.offsetY = tab.viewState.panY;
    runtime.canvasView.scale = clampCanvasScale(tab.viewState.zoom);
    applyCanvasTransform(runtime);
    scheduleCanvasImageResolutionCheck(runtime);
  } else if (runtime.currentPage && pageWorldIsRenderable(runtime)) {
    runtime.session.saveViewState(tab.id, captureActiveTabViewState(runtime));
  }
  renderBlockOverlays(runtime, runtime.currentPage?.blocks || []);
  if (typeof renderInfoPanelsForRuntime === 'function') renderInfoPanelsForRuntime(runtime);
}

function setActiveHighlightGroupForCurrentTab(runtime, groupId, { enabled = true, dimmed = true } = {}) {
  const tab = activeTab(runtime);
  if (!tab) return false;
  const group = (runtime.currentPage?.highlightGroups || []).find((item) => item.id === groupId);
  setCheckedHighlightGroupIdsForViewState(
    tab.viewState,
    group && enabled ? [group.id] : []
  );
  prepareActiveTabHighlightState(runtime);
  renderBlockOverlays(runtime, runtime.currentPage?.blocks || []);
  runtime.session.saveViewState(tab.id, { ...tab.viewState });
  updatePaneToolbarPresentation(getWorkspacePane(runtime.paneId));
  if (typeof syncHighlightInfoPanelsForRuntime === 'function') {
    syncHighlightInfoPanelsForRuntime(runtime);
  }
  return Boolean(group);
}

function toggleHighlightGroupForCurrentTab(runtime, groupId, checked = null) {
  const tab = activeTab(runtime);
  const group = (runtime.currentPage?.highlightGroups || []).find((item) => item.id === groupId);
  if (!tab || !group || runtime.highlightEditDraft) return false;
  const next = new Set(checkedHighlightGroupIdsForViewState(tab.viewState));
  const shouldCheck = checked === null ? !next.has(groupId) : Boolean(checked);
  if (shouldCheck) next.add(groupId);
  else next.delete(groupId);
  setCheckedHighlightGroupIdsForViewState(tab.viewState, [...next]);
  prepareActiveTabHighlightState(runtime);
  renderBlockOverlays(runtime, runtime.currentPage?.blocks || []);
  runtime.session.saveViewState(tab.id, { ...tab.viewState });
  scheduleWorkspaceStateSave();
  updatePaneToolbarPresentation(getWorkspacePane(runtime.paneId));
  if (typeof syncHighlightInfoPanelsForRuntime === 'function') {
    syncHighlightInfoPanelsForRuntime(runtime);
  }
  return true;
}

function normalizedHighlightGroupsForClient(groups, blocks = []) {
  const validBlockIds = new Set((blocks || []).map((block) => block.id));
  return (Array.isArray(groups) ? groups : [])
    .map((group) => ({
      id: group.id,
      name: String(group.name || '').trim(),
      info: typeof group.info === 'string' ? group.info : '',
      blockIds: [...new Set(highlightBlockIds(group)
        .filter((blockId) => validBlockIds.has(blockId)))]
    }))
    .filter((group) => group.blockIds.length > 0);
}

async function persistHighlightGroups(runtime, groups) {
  const pageId = runtime?.currentPage?.id;
  if (!pageId) return null;
  const operation = captureRuntimeOperation(runtime, { scope: 'highlight-save', pageId });
  try {
    const savedPage = await request(pageApiUrl(pageId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        highlightGroups: normalizedHighlightGroupsForClient(groups, runtime.currentPage.blocks || [])
      })
    });
    const ownerCurrent = runtimeOperationIsCurrent(operation);
    const canonical = commitCanonicalPage(savedPage, {
      originRuntime: ownerCurrent ? runtime : null
    });
    if (ownerCurrent && runtime.currentPage?.id === pageId) {
      runtime.currentPage = canonical;
      prepareActiveTabHighlightState(runtime);
      renderBlockOverlays(runtime, runtime.currentPage.blocks || []);
    }
    renderPaneToolbarCollection();
    if (runtimeOperationIsCurrent(operation)) {
      showRuntimeStatus(runtime, 'Saved', false, 1800);
    }
    return canonical;
  } catch (error) {
    if (runtimeOperationIsCurrent(operation)) showRuntimeStatus(runtime, error.message, true);
    return null;
  }
}

function clearHighlightGroupFromOpenTabViews(pageId, groupId) {
  for (const pane of workspace.state.panes) {
    for (const tab of pane.session.tabs()) {
      const viewStates = [];
      if (tab.currentPageId === pageId) viewStates.push(tab.viewState);
      if (tab.pageViewStates?.[pageId]) viewStates.push(tab.pageViewStates[pageId]);
      for (const viewState of new Set(viewStates)) {
        const checked = checkedHighlightGroupIdsForViewState(viewState)
          .filter((checkedId) => checkedId !== groupId);
        setCheckedHighlightGroupIdsForViewState(viewState, checked);
      }
    }
  }
}

async function renameHighlightGroup(runtime, groupId, name) {
  const nextName = String(name || '').trim();
  const groups = Array.isArray(runtime?.currentPage?.highlightGroups)
    ? runtime.currentPage.highlightGroups : [];
  if (!nextName || !groups.some((group) => group.id === groupId)) return false;
  const saved = await persistHighlightGroups(runtime, groups.map((group) => (
    group.id === groupId ? { ...group, name: nextName } : group
  )));
  if (!saved) return false;
  const pane = getWorkspacePane(runtime.paneId);
  if (runtime.dom.highlightMenu && !runtime.dom.highlightMenu.hidden) {
    renderHighlightMenu(runtime);
    positionHighlightMenu(pane);
  }
  return true;
}

async function deleteHighlightGroup(runtime, groupId) {
  const pageId = runtime?.currentPage?.id;
  const groups = Array.isArray(runtime?.currentPage?.highlightGroups)
    ? runtime.currentPage.highlightGroups : [];
  if (!pageId || !groups.some((group) => group.id === groupId)) return false;
  const saved = await persistHighlightGroups(runtime, groups.filter((group) => group.id !== groupId));
  if (!saved) return false;
  clearHighlightGroupFromOpenTabViews(pageId, groupId);
  if (typeof pruneInfoPanelsForDeletedOwner === 'function') {
    pruneInfoPanelsForDeletedOwner(pageId, 'highlight', groupId);
  }
  if (runtime.currentPage?.id === pageId) {
    prepareActiveTabHighlightState(runtime);
    renderBlockOverlays(runtime, runtime.currentPage.blocks || []);
  }
  renderPaneToolbarCollection();
  const pane = getWorkspacePane(runtime.paneId);
  if (runtime.dom.highlightMenu && !runtime.dom.highlightMenu.hidden) {
    renderHighlightMenu(runtime);
    positionHighlightMenu(pane);
  }
  return true;
}

function nextHighlightGroupName(groups = []) {
  const usedNames = new Set((groups || []).map((group) => String(group.name || '').trim()));
  let index = 1;
  while (usedNames.has(`New Group ${index}`)) index += 1;
  return `New Group ${index}`;
}

function createHighlightGroupId() {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  return `highlight_group_${suffix.replace(/[^a-z0-9_-]/gi, '_')}`;
}

function setHighlightEditMode(runtime, active) {
  const wasActive = runtime.blockVisualMode === BLOCK_MODE.HIGHLIGHT_EDIT;
  if (active && !wasActive && typeof suspendInfoPanelsForRuntime === 'function') {
    suspendInfoPanelsForRuntime(runtime);
  }
  setEditMenuOpen(runtime, false);
  setHighlightMenuOpen(runtime, false);
  runtime.blockVisualMode = active ? BLOCK_MODE.HIGHLIGHT_EDIT : BLOCK_MODE.NORMAL;
  runtime.dom.canvasArea?.classList.toggle('highlight-edit-mode', active);
  if (!active) prepareActiveTabHighlightState(runtime);
  updatePaneToolbarPresentation(getWorkspacePane(runtime.paneId));
  if (!active && wasActive && typeof resumeInfoPanelsForRuntime === 'function') {
    resumeInfoPanelsForRuntime(runtime);
  }
}

function beginHighlightEditDraft(runtime, { groupId = null, name, selectedBlockIds = [] } = {}) {
  if (!runtimeIsLive(runtime) || !runtime.currentPage || runtime.blockEditMode
    || runtime.pageEditMode || runtime.highlightEditDraft) return false;
  closeAddLinkPopover(runtime);
  closeBlockLinkChoicePopover();
  clearCanvasPointerHover(runtime);
  const tab = activeTab(runtime);
  if (!tab) return false;
  runtime.highlightEditDraft = {
    paneId: runtime.paneId,
    tabId: tab.id,
    pageId: runtime.currentPage.id,
    groupId,
    id: groupId || createHighlightGroupId(),
    isNew: !groupId,
    name,
    preEditCheckedGroupIds: checkedHighlightGroupIdsForViewState(tab.viewState)
  };
  runtime.selectedHighlightBlockIds = new Set(selectedBlockIds);
  setHighlightEditMode(runtime, true);
  renderBlockOverlays(runtime, runtime.currentPage.blocks || []);
  showRuntimeStatus(runtime, '');
  return true;
}

function beginNewHighlightGroup(runtime) {
  const groups = Array.isArray(runtime.currentPage?.highlightGroups)
    ? runtime.currentPage.highlightGroups : [];
  return beginHighlightEditDraft(runtime, {
    name: nextHighlightGroupName(groups),
    selectedBlockIds: []
  });
}

function beginAdjustHighlightGroup(runtime, groupId) {
  const group = (runtime.currentPage?.highlightGroups || []).find((item) => item.id === groupId);
  if (!group) return false;
  return beginHighlightEditDraft(runtime, {
    groupId: group.id,
    name: group.name,
    selectedBlockIds: highlightBlockIds(group)
  });
}

function toggleHighlightEditBlock(runtime, blockId) {
  if (!runtime.highlightEditDraft || runtime.blockVisualMode !== BLOCK_MODE.HIGHLIGHT_EDIT
    || !(runtime.currentPage?.blocks || []).some((block) => block.id === blockId)) return false;
  if (runtime.selectedHighlightBlockIds.has(blockId)) runtime.selectedHighlightBlockIds.delete(blockId);
  else runtime.selectedHighlightBlockIds.add(blockId);
  const overlay = blockOverlay(runtime, blockId);
  const block = runtime.currentPage.blocks.find((item) => item.id === blockId);
  if (overlay && block) setBlockState(runtime, overlay, 'mode', blockBaseState(runtime, block));
  return true;
}

function cancelHighlightEdits(runtime) {
  const draft = runtime?.highlightEditDraft;
  if (!draft) return false;
  const tab = activeTab(runtime);
  if (tab?.id === draft.tabId) {
    setCheckedHighlightGroupIdsForViewState(tab.viewState, draft.preEditCheckedGroupIds);
    runtime.session.saveViewState(tab.id, { ...tab.viewState });
  }
  runtime.highlightEditDraft = null;
  runtime.selectedHighlightBlockIds = new Set();
  setHighlightEditMode(runtime, false);
  renderBlockOverlays(runtime, runtime.currentPage?.blocks || []);
  showRuntimeStatus(runtime, '');
  return true;
}

function finishHighlightEdit(draft, { uncheckedGroupId = null } = {}) {
  const ownerPane = getWorkspacePane(draft.paneId);
  const runtime = runtimeForPane(ownerPane);
  const tab = ownerPane?.session?.tabById(draft.tabId);
  if (tab) {
    const checked = uncheckedGroupId
      ? draft.preEditCheckedGroupIds.filter((groupId) => groupId !== uncheckedGroupId)
      : draft.preEditCheckedGroupIds;
    setCheckedHighlightGroupIdsForViewState(tab.viewState, checked);
    ownerPane.session.saveViewState(tab.id, { ...tab.viewState });
  }
  if (runtime?.highlightEditDraft === draft) {
    runtime.highlightEditDraft = null;
    runtime.selectedHighlightBlockIds = new Set();
    setHighlightEditMode(runtime, false);
    renderBlockOverlays(runtime, runtime.currentPage?.blocks || []);
  }
}

async function saveHighlightEdits(runtime) {
  const draft = runtime?.highlightEditDraft;
  if (!draft || runtime.highlightSaveInProgress || runtime.currentPage?.id !== draft.pageId) return false;
  const groups = Array.isArray(runtime.currentPage.highlightGroups)
    ? runtime.currentPage.highlightGroups : [];
  if (!draft.isNew && !groups.some((group) => group.id === draft.groupId)) {
    cancelHighlightEdits(runtime);
    return false;
  }
  const validSelectedBlockIds = (runtime.currentPage.blocks || [])
    .map((block) => block.id)
    .filter((blockId) => runtime.selectedHighlightBlockIds.has(blockId));
  if (draft.isNew && validSelectedBlockIds.length === 0) {
    finishHighlightEdit(draft);
    showRuntimeStatus(runtime, '');
    return true;
  }
  const savedGroup = {
    id: draft.id,
    name: draft.name,
    info: typeof groups.find((group) => group.id === draft.groupId)?.info === 'string'
      ? groups.find((group) => group.id === draft.groupId).info
      : '',
    blockIds: validSelectedBlockIds
  };
  const removesExistingGroup = !draft.isNew && validSelectedBlockIds.length === 0;
  const nextGroups = draft.isNew
    ? [...groups, savedGroup]
    : removesExistingGroup
      ? groups.filter((group) => group.id !== draft.groupId)
      : groups.map((group) => group.id === draft.groupId ? savedGroup : group);
  runtime.highlightSaveInProgress = true;
  updatePaneToolbarPresentation(getWorkspacePane(runtime.paneId));
  try {
    const saved = await persistHighlightGroups(runtime, nextGroups);
    if (!saved) return false;
    if (removesExistingGroup) clearHighlightGroupFromOpenTabViews(draft.pageId, draft.id);
    finishHighlightEdit(draft, {
      uncheckedGroupId: removesExistingGroup ? draft.id : null
    });
    return true;
  } finally {
    if (runtimeIsLive(runtime)) {
      runtime.highlightSaveInProgress = false;
      updatePaneToolbarPresentation(getWorkspacePane(runtime.paneId));
    }
  }
}

function updatePageHistoryButtons(runtime) {
  if (!runtimeIsLive(runtime)) return;
  const canNavigate = Boolean(runtime.currentPage) && !runtime.pageHistoryNavigationInProgress;
  if (runtime.dom.pageHistoryBackButton) {
    runtime.dom.pageHistoryBackButton.disabled = !canNavigate || !pageHistoryTarget(runtime, -1);
  }
  if (runtime.dom.pageHistoryForwardButton) {
    runtime.dom.pageHistoryForwardButton.disabled = !canNavigate || !pageHistoryTarget(runtime, 1);
  }
  updatePaneToolbarPresentation(getWorkspacePane(runtime.paneId));
}

const PAGE_HISTORY_MODES = new Set(['push', 'back-forward', 'replace', 'preserve']);

function requirePageHistoryMode(historyMode) {
  if (!PAGE_HISTORY_MODES.has(historyMode)) {
    throw new TypeError('Page loading requires an explicit history mode.');
  }
  return historyMode;
}

function commitPageHistoryOpen(runtime, pageId, { historyMode, historyIndex = null } = {}) {
  requirePageHistoryMode(historyMode);
  if (historyMode === 'replace') {
    globalThis.forgetMarkdownEditHistory?.(runtime.session.activeTab());
  }
  runtime.session.navigateActive(pageId, { mode: historyMode, historyIndex });
  globalThis.applyRestoredPageViewState?.(runtime.session.activeTab(), pageId);
  scheduleHnSessionReferenceReconcile();
  renderTabStrip({ ensureActiveVisible: true, preserveLayoutTransition: true });
  updatePageHistoryButtons(runtime);
}

async function completePageOpen(runtime, pageEntry, page, historyOptions = {}) {
  if (!runtimeIsLive(runtime)) return false;
  if (runtime === activePaneRuntime() && runtime.currentPage?.id !== page.id) {
    resetRightRelationFilters();
  }
  runtime.currentPageEntry = pageEntry;
  commitPageHistoryOpen(runtime, page.id, historyOptions);
  runtime.currentPage = commitCanonicalPage(page, { originRuntime: runtime });
  prepareActiveTabHighlightState(runtime);
  renderPage(runtime, runtime.currentPage, { installCanonical: false });
  restoreActiveTabViewState(runtime);
  if (runtime === activePaneRuntime()) await persistLastOpenedPage(page.id);
  scheduleWorkspaceStateSave();
  return true;
}

async function loadPage(runtime, pageEntry, {
  showErrors = true,
  historyMode = null,
  historyIndex = null,
  preferCanonical = false,
  saveCurrentView = true,
  resolvedPage = null
} = {}) {
  if (!runtimeIsLive(runtime) || !pageEntry?.id) return false;
  requirePageHistoryMode(historyMode);
  if (runtime === activePaneRuntime()) commitFocusedMarkdownEditor();
  if (historyMode === 'push' && activeTab(runtime)?.currentPageId === pageEntry.id) {
    updatePageHistoryButtons(runtime);
    return true;
  }
  if (runtime === activePaneRuntime()) {
    globalThis.clearMarkdownClipboardSelection?.({ clearBrowserSelection: true });
    closePageMetaModal();
    closePageContextMenu();
    closeFolderContextMenu();
    closeRelationContextMenu();
    closeResourceContextMenu();
  }
  prepareInfoPanelsForRuntimeContextChange?.(runtime);
  closeAddLinkPopover(runtime);
  setEditMenuOpen(runtime, false);
  setHighlightMenuOpen(runtime, false);
  if (runtime.blockEditMode) cancelBlockEdits(runtime);
  if (runtime.pageEditMode) cancelPageEdits(runtime);
  if (runtime.highlightEditDraft) cancelHighlightEdits(runtime);
  if (saveCurrentView) saveActiveTabViewState(runtime);
  runtime.pageLoadSequence += 1;
  runtime.loadGeneration = runtime.pageLoadSequence;
  const operation = captureRuntimeOperation(runtime, {
    scope: 'page-load',
    pageId: pageEntry.id,
    requirePage: false,
    requireMount: false
  });
  showRuntimeStatus(runtime, '');
  try {
    const page = resolvedPage?.id === pageEntry.id
      ? resolvedPage
      : preferCanonical && canonicalPages.has(pageEntry.id)
        ? canonicalPages.get(pageEntry.id)
        : await request(pageApiUrl(pageEntry.id));
    if (!runtimeOperationIsCurrent(operation)) return false;
    return completePageOpen(runtime, pageEntry, page, { historyMode, historyIndex });
  } catch (error) {
    if (runtimeOperationIsCurrent(operation) && showErrors) {
      showRuntimeStatus(runtime, error.message, true);
    }
    return false;
  }
}

function capturePageHistoryTraversalOwner(runtime) {
  const pane = getWorkspacePane(runtime.paneId);
  const tab = activeTab(runtime);
  return {
    runtime,
    pane,
    session: runtime.session,
    tab,
    history: tab?.history || null,
    historyIndex: tab?.historyIndex ?? null
  };
}

function pageHistoryTraversalStillOwned(owner, expectedLoadSequence = null) {
  if (!owner?.pane || !owner?.tab) return false;
  if (!runtimeIsLive(owner.runtime) || owner.runtime.session !== owner.session
    || activeTab(owner.runtime) !== owner.tab) {
    return false;
  }
  if (owner.tab.history !== owner.history || owner.tab.historyIndex !== owner.historyIndex) {
    return false;
  }
  if (Number.isInteger(expectedLoadSequence)) {
    if (owner.runtime.pageLoadSequence !== expectedLoadSequence) return false;
  }
  return true;
}

async function navigatePageHistory(runtime, direction) {
  if (!runtimeIsLive(runtime) || runtime.pageHistoryNavigationInProgress
    || !runtime.currentPage || pageHistoryNavigationBlocked(runtime)) return false;
  const traversalOwner = capturePageHistoryTraversalOwner(runtime);
  let target = pageHistoryTarget(runtime, direction);
  if (!target) {
    updatePageHistoryButtons(runtime);
    return false;
  }
  runtime.pageHistoryNavigationInProgress = true;
  updatePageHistoryButtons(runtime);
  try {
    while (target) {
      const pageEntry = pageIndex.pages.find((page) => page.id === target.pageId);
      const expectedLoadSequence = pageEntry
        ? runtime.pageLoadSequence + 1
        : null;
      if (pageEntry && await navigateCurrentTabToPage(runtime, target.pageId, {
        navigationKind: 'history-traversal',
        historyIndex: target.index,
        showErrors: false,
        unavailableMessage: null
      })) return true;
      if (!pageHistoryTraversalStillOwned(traversalOwner, expectedLoadSequence)) return false;
      target = traversalOwner.session.historyTarget(
        direction,
        pageHistoryEntryExists,
        target.index
      );
    }
    return false;
  } finally {
    if (runtimeIsLive(runtime)) {
      runtime.pageHistoryNavigationInProgress = false;
      updatePageHistoryButtons(runtime);
    }
  }
}

async function navigateCurrentTabToPage(runtime, targetPageId, navigationContext = {}) {
  const {
    navigationKind = 'normal',
    historyIndex = null,
    showErrors = true,
    preferCanonical = false,
    saveCurrentView = true,
    unavailableMessage = 'Linked page is unavailable.',
    resolvedPageEntry = null,
    resolvedPage = null
  } = navigationContext || {};
  const historyOptions = navigationKind === 'history-traversal'
    ? { historyMode: 'back-forward', historyIndex }
    : navigationKind === 'normal'
      ? { historyMode: 'push', historyIndex: null }
      : null;
  if (!historyOptions || (navigationKind === 'history-traversal'
    && !Number.isInteger(historyIndex))) return false;
  const targetPageEntry = resolvedPageEntry?.id === targetPageId
    ? resolvedPageEntry
    : pageIndex?.pages?.find((page) => page.id === targetPageId);
  if (!targetPageEntry) {
    if (unavailableMessage) showRuntimeStatus(runtime, unavailableMessage, true, 2400);
    return false;
  }

  return loadPage(runtime, targetPageEntry, {
    showErrors,
    ...historyOptions,
    preferCanonical,
    saveCurrentView,
    ...(resolvedPage?.id === targetPageId ? { resolvedPage } : {})
  });
}

async function switchToTab(tabId, paneId = getActivePane()?.id) {
  commitFocusedMarkdownEditor();
  if (paneId && paneId !== getActivePane()?.id) setActiveWorkspacePane(paneId);
  const runtime = activePaneRuntime();
  const target = runtime.session.tabById(tabId);
  if (!target || target.id === activeTab(runtime)?.id) return false;
  globalThis.clearMarkdownClipboardSelection?.({ clearBrowserSelection: true });
  prepareInfoPanelsForRuntimeContextChange?.(runtime);
  saveActiveTabViewState(runtime);
  if (runtime.blockEditMode) cancelBlockEdits(runtime);
  if (runtime.pageEditMode) cancelPageEdits(runtime);
  if (runtime.highlightEditDraft) cancelHighlightEdits(runtime);
  closePageMetaModal();
  animateTabStripLayoutChange(() => runtime.session.activateTab(tabId));
  if (!target.currentPageId) {
    renderEmptyTab(runtime);
    return true;
  }
  const pageEntry = pageIndex.pages.find((page) => page.id === target.currentPageId);
  if (!pageEntry) {
    renderEmptyTab(runtime, 'This Page is no longer available.');
    return false;
  }
  return loadPage(runtime, pageEntry, {
    historyMode: 'preserve', preferCanonical: true, saveCurrentView: false
  });
}

function createEmptyTab(paneId = getActivePane()?.id) {
  if (tabReorderState || sidebarPageDragState) return null;
  if (paneId && paneId !== getActivePane()?.id) setActiveWorkspacePane(paneId);
  const runtime = activePaneRuntime();
  prepareInfoPanelsForRuntimeContextChange?.(runtime);
  saveActiveTabViewState(runtime);
  if (runtime.blockEditMode) cancelBlockEdits(runtime);
  if (runtime.pageEditMode) cancelPageEdits(runtime);
  if (runtime.highlightEditDraft) cancelHighlightEdits(runtime);
  closePageMetaModal();
  globalThis.clearMarkdownClipboardSelection?.({ clearBrowserSelection: true });
  const tab = animateTabStripLayoutChange(() => runtime.session.createTab(null));
  renderEmptyTab(runtime);
  return tab;
}

async function openPageInNewTab(runtime, pageId, {
  insertionIndex = null,
  pageTitle: requestedPageTitle = null,
  onTabRendered = null
} = {}) {
  if (!runtimeIsLive(runtime) || runtime.linkPickMode) return false;
  const pageEntry = pageIndex.pages.find((page) => page.id === pageId);
  if (!pageEntry) return false;
  prepareInfoPanelsForRuntimeContextChange?.(runtime);
  saveActiveTabViewState(runtime);
  if (runtime.blockEditMode) cancelBlockEdits(runtime);
  if (runtime.pageEditMode) cancelPageEdits(runtime);
  if (runtime.highlightEditDraft) cancelHighlightEdits(runtime);
  closePageMetaModal();
  globalThis.clearMarkdownClipboardSelection?.({ clearBrowserSelection: true });
  const previousTabId = activeTab(runtime)?.id || null;
  const usesDragSettlement = typeof onTabRendered === 'function';
  const createTab = () => runtime.session.createTab(pageId, { insertionIndex });
  const tab = usesDragSettlement
    ? createTab()
    : animateTabStripLayoutChange(createTab);
  if (usesDragSettlement) renderTabStrip({ ensureActiveVisible: true });
  const tabElement = activePaneTabStrip()?.querySelector(
    `.viewer-tab[data-tab-id="${CSS.escape(tab.id)}"]`
  );
  if (tabElement && requestedPageTitle) applyTabTitlePresentation(tabElement, requestedPageTitle);
  onTabRendered?.(tab, tabElement);
  const loaded = await loadPage(runtime, pageEntry, {
    historyMode: 'preserve', preferCanonical: true, saveCurrentView: false
  });
  if (!loaded) {
    const restorePreviousTab = () => {
      if (!runtimeIsLive(runtime)) return;
      const createdTab = runtime.session.tabById(tab.id);
      if (createdTab !== tab
        || activeTab(runtime) !== tab
        || createdTab.currentPageId !== pageId) return;
      runtime.session.closeTab(tab.id);
      if (previousTabId) runtime.session.activateTab(previousTabId);
    };
    if (usesDragSettlement) {
      restorePreviousTab();
      renderTabStrip();
    } else {
      animateTabStripLayoutChange(restorePreviousTab);
    }
  }
  return loaded;
}

function workspaceTabForPageInPane(paneId, pageId) {
  const pane = getWorkspacePane(paneId);
  const tab = pane?.session?.mostRecentTabForPage(pageId);
  return pane && tab ? { paneId: pane.id, pane, session: pane.session, tab } : null;
}

function workspaceTabForPage(pageId) {
  return workspaceTabForPageInPane(getActivePane()?.id, pageId);
}

function activateWorkspaceTab(target) {
  if (!target?.tab) return false;
  const pane = target.pane || getWorkspacePane(target.paneId);
  if (!pane?.element?.isConnected) return false;
  setActiveWorkspacePane(target.paneId);
  const runtime = runtimeForPane(pane);
  if (!runtime) return false;
  if (target.tab.id === activeTab(runtime)?.id) {
    runtime.session.activateTab(target.tab.id);
    refreshActivePaneWindowChrome(runtime);
    return true;
  }
  return switchToTab(target.tab.id, target.paneId);
}

function openPageFromSidebar(pageId) {
  const runtime = activePaneRuntime();
  if (!runtime || runtime.linkPickMode) return false;
  let active = activeTab(runtime);
  if (!active) {
    runtime.session.createTab(null);
    renderTabStrip({ ensureActiveVisible: true });
    active = activeTab(runtime);
  }
  const existing = workspaceTabForPage(pageId);
  if (existing) return activateWorkspaceTab(existing);
  if (active?.currentPageId === null) return populateActiveEmptyTab(runtime, pageId);
  return navigateCurrentTabToPage(runtime, pageId, {
    preferCanonical: true,
    unavailableMessage: null
  });
}

function disposeWorkspacePaneView(pane) {
  const runtime = runtimeForPane(pane);
  if (!pane || !runtime) return false;
  disposeInfoPanelsForRuntime(runtime);
  disposeCanvasRuntime(runtime);
  runtime.pageLoadSequence += 1;
  runtime.loadGeneration = runtime.pageLoadSequence;
  runtime.mounted = {
    generation: (runtime.mounted?.generation || 0) + 1,
    pageId: null,
    kind: null
  };
  runtime.lifecycleEpoch += 1;
  runtime.disposed = true;
  pane.element?.querySelectorAll?.('.markdown-page-layer').forEach((layer) => {
    globalThis.destroyMarkdownPageLayer?.(layer);
  });
  globalThis.destroyHnTextPageLayer?.(runtime.dom?.canvasStage);
  runtime.currentPage = null;
  runtime.currentPageEntry = null;
  runtime.dom?.toolbarRegion?.remove();
  for (const key of Object.keys(runtime.dom)) runtime.dom[key] = null;
  paneTabRegion(pane.id)?.remove();
  pane.element?.remove();
  pane.element = null;
  scheduleHnSessionReferenceReconcile();
  return true;
}

function closeWorkspacePaneWithTabs(pane, { closingTabId = null } = {}) {
  if (!pane || workspace.state.panes.length <= 1) return false;
  if (closingTabId) pane.session.closeTab(closingTabId, { ensureEmptyTab: false });
  if (!disposeWorkspacePaneView(pane)) return false;
  const removed = workspace.removePane(pane.id);
  if (!removed) return false;
  const availableWidth = workspacePaneAvailableWidth();
  if (availableWidth > 0) workspace.fitToWidth(availableWidth);
  renderWorkspacePaneStackState();
  const nextRuntime = runtimeForPane(removed.activePane || getActivePane());
  if (nextRuntime) refreshActivePaneWindowChrome(nextRuntime);
  scheduleHnSessionReferenceReconcile();
  return true;
}

async function closeTab(tabId, paneId = getActivePane()?.id) {
  if (paneId && paneId !== getActivePane()?.id) setActiveWorkspacePane(paneId);
  const pane = getActivePane();
  const runtime = runtimeForPane(pane);
  if (!runtime) return false;
  const closing = runtime.session.tabById(tabId);
  if (!closing) return false;
  const wasActive = closing.id === activeTab(runtime)?.id;
  if (wasActive) {
    commitFocusedMarkdownEditor();
    globalThis.clearMarkdownClipboardSelection?.({ clearBrowserSelection: true });
    prepareInfoPanelsForRuntimeContextChange?.(runtime);
    if (runtime.blockEditMode) cancelBlockEdits(runtime);
    if (runtime.pageEditMode) cancelPageEdits(runtime);
    if (runtime.highlightEditDraft) cancelHighlightEdits(runtime);
    closePageMetaModal();
  }
  if (runtime.session.tabs().length === 1 && workspace.state.panes.length > 1) {
    return closeWorkspacePaneWithTabs(pane, { closingTabId: tabId });
  }
  const next = animateTabStripLayoutChange(() => runtime.session.closeTab(tabId));
  scheduleHnSessionReferenceReconcile();
  if (!wasActive) return true;
  if (!next?.currentPageId) {
    renderEmptyTab(runtime);
    return true;
  }
  const entry = pageIndex.pages.find((page) => page.id === next.currentPageId);
  return entry
    ? loadPage(runtime, entry, {
      historyMode: 'preserve', preferCanonical: true, saveCurrentView: false
    })
    : (renderEmptyTab(runtime, 'This Page is no longer available.'), false);
}

async function closeAllTabs(runtime = activePaneRuntime()) {
  if (!runtimeIsLive(runtime)) return false;
  if (tabReorderState || sidebarPageDragState) return false;
  prepareInfoPanelsForRuntimeContextChange?.(runtime);
  if (runtime.blockEditMode) cancelBlockEdits(runtime);
  if (runtime.pageEditMode) cancelPageEdits(runtime);
  if (runtime.highlightEditDraft) cancelHighlightEdits(runtime);
  closePageMetaModal();
  globalThis.clearMarkdownClipboardSelection?.({ clearBrowserSelection: true });
  if (workspace.state.panes.length > 1) {
    return closeWorkspacePaneWithTabs(getWorkspacePane(runtime.paneId));
  }
  animateTabStripLayoutChange(() => runtime.session.reset(null));
  scheduleHnSessionReferenceReconcile();
  renderEmptyTab(runtime);
  return true;
}

async function openTabListMenu(event, paneId = getActivePane()?.id) {
  if (tabReorderState || sidebarPageDragState || !window.nativeContextMenu?.available()) return;
  if (paneId && paneId !== getActivePane()?.id) setActiveWorkspacePane(paneId);
  clearTabTitleTooltip();
  const runtime = runtimeForPane(paneId);
  if (!runtime) return;
  const operation = captureRuntimeOperation(runtime, {
    scope: 'tab-list-menu', requirePage: false, requireMount: false
  });
  const tabs = runtime.session.tabs();
  const command = await window.nativeContextMenu.open(event, {
    type: 'tab-list',
    targetId: tabStripIdForPane(paneId),
    activeTabId: activeTab(runtime)?.id || '',
    tabs: tabs.map((tab) => ({ id: tab.id, title: pageTitleForTab(tab) }))
  });
  if (tabReorderState || sidebarPageDragState || !runtimeOperationIsCurrent(operation)) return;
  if (command === 'close-all-tabs') {
    await closeAllTabs(runtime);
    return;
  }
  if (!command?.startsWith('activate-tab:')) return;
  const tabId = command.slice('activate-tab:'.length);
  const tab = runtime.session.tabById(tabId);
  if (tab) await activateWorkspaceTab({ paneId, pane: getWorkspacePane(paneId), session: runtime.session, tab });
}


function renderEmptyTab(runtime, message = '') {
  if (!runtimeIsLive(runtime)) return false;
  prepareInfoPanelsForRuntimeContextChange?.(runtime);
  if (runtime.blockEditMode) cancelBlockEdits(runtime);
  if (runtime.pageEditMode) cancelPageEdits(runtime);
  if (runtime.highlightEditDraft) cancelHighlightEdits(runtime);
  runtime.currentPage = null;
  runtime.currentPageEntry = null;
  runtime.mounted = {
    generation: (runtime.mounted?.generation || 0) + 1,
    pageId: null,
    kind: 'empty-tab'
  };
  updatePageHistoryButtons(runtime);
  closeAddLinkPopover(runtime);
  setEditMenuOpen(runtime, false);
  setHighlightMenuOpen(runtime, false);
  clearBlockDrawing(runtime);
  setBlockEditMode(runtime, false);
  if (runtime.dom.pageTitleDisplay) runtime.dom.pageTitleDisplay.textContent = '';
  if (runtime.dom.pageTitle) runtime.dom.pageTitle.value = '';
  if (runtime.dom.titleForm) runtime.dom.titleForm.hidden = true;
  if (runtime.dom.pageTitleDisplay) runtime.dom.pageTitleDisplay.hidden = false;
  resetPageTypePlaceholderSurface(runtime);
  renderCanvas(runtime, [], []);
  renderInfoPanelsForRuntime?.(runtime);
  const showEmptyTabActions = activeTab(runtime)?.currentPageId === null;
  if (runtime.dom.emptyCanvas) runtime.dom.emptyCanvas.hidden = showEmptyTabActions;
  if (runtime.dom.emptyTabState) runtime.dom.emptyTabState.hidden = !showEmptyTabActions;

  if (runtime === activePaneRuntime()) {
    resetRightRelationFilters();
    closePageMetaModal();
    closePageContextMenu();
    closeResourceContextMenu();
    renderMaintenanceResources(runtime, { objects: [], maintenanceResources: [] });
    renderExternalLinks(runtime, { externalLinks: [] });
    renderRelations(runtime, { blocks: [], backlinks: [] });
    addFileButton.disabled = true;
    for (const button of pageList.querySelectorAll('.page-link')) button.classList.remove('active');
    refreshMarkdownControlStrip(runtime);
  }
  updateEditAvailability(runtime);
  if (message) showRuntimeStatus(runtime, message, true);
  return true;
}

function renderNoPage(message = '') {
  canonicalPages.clear();
  resetWorkspacePanes();
  activePaneRuntime().session.reset(null);
  renderTabStrip({ ensureActiveVisible: true });
  renderEmptyTab(activePaneRuntime(), message);
}

function cancelTitleEdit(runtime) {
  if (!runtimeIsLive(runtime) || !runtime.currentPage) return false;
  runtime.cancelTitleBlur = true;
  runtime.dom.pageTitle.value = runtime.currentPage.title;
  closeTitleEditor(runtime);
  showRuntimeStatus(runtime, '');
  setTimeout(() => {
    if (runtimeIsLive(runtime)) runtime.cancelTitleBlur = false;
  }, 0);
  return true;
}

async function saveTitle(runtime) {
  if (!runtimeIsLive(runtime) || !pageIsSupported(runtime.currentPage)
    || runtime.titleSaveInProgress
    || markdownPageMutationLocks.has(runtime.currentPage.id)) return;

  const ownerPane = getWorkspacePane(runtime.paneId);
  const pageId = runtime.currentPage.id;
  const beforeTitle = runtime.currentPage.title;
  const nextTitle = runtime.dom.pageTitle.value.trim();
  if (!nextTitle) {
    runtime.dom.pageTitle.value = runtime.currentPage.title;
    closeTitleEditor(runtime);
    return;
  }

  if (nextTitle === runtime.currentPage.title) {
    closeTitleEditor(runtime);
    return;
  }

  const savedTitle = makeUniquePageTitle(nextTitle, runtime.currentPage.id);
  const operation = captureRuntimeOperation(runtime, { scope: 'page-title-save', pageId });
  runtime.titleSaveInProgress = true;
  showRuntimeStatus(runtime, 'Saving…');
  runtime.dom.pageTitleDisplay.textContent = savedTitle;
  closeTitleEditor(runtime);
  try {
    const savedPage = await persistPageTitle({
      runtime,
      operation,
      paneId: ownerPane?.id || null,
      pageId,
      title: savedTitle
    });
    recordCommittedPageTitleChange({
      paneId: ownerPane?.id || null,
      pageId,
      beforeTitle,
      afterTitle: savedPage.title
    });
    if (runtimeOperationIsCurrent(operation)) {
      showRuntimeStatus(runtime, savedPage.title === nextTitle
        ? 'Saved'
        : `Saved as "${savedPage.title}".`, false, 1800);
    }
    return true;
  } catch (error) {
    const canonical = canonicalPages.get(pageId);
    if (runtimeOperationIsCurrent(operation) && canonical) {
      runtime.dom.pageTitleDisplay.textContent = canonical.title;
      runtime.dom.pageTitle.value = canonical.title;
      showRuntimeStatus(runtime, error.message, true);
    }
    return false;
  } finally {
    if (runtimeOperationOwnerIsCurrent(operation)) runtime.titleSaveInProgress = false;
  }
}

async function convertCurrentPageType(runtime, targetType) {
  if (!runtimeIsLive(runtime) || !pageIsSupported(runtime.currentPage)
    || runtime.pageEditSaveInProgress || runtime.titleSaveInProgress) return false;
  const ownerPane = getWorkspacePane(runtime.paneId);
  const ownerTab = activeTab(runtime);
  const sourcePage = runtime.currentPage;
  const pageId = sourcePage.id;
  if (!ownerPane || !ownerTab || markdownPageMutationLocks.has(pageId)) return false;
  const operation = captureRuntimeOperation(runtime, {
    scope: 'page-type-conversion',
    pageId
  });
  const normalizedTarget = pageTypesModel.normalizePageType(targetType);
  const currentType = pageTypesModel.normalizePageType(runtime.currentPage.type);
  setPageTypeSubmenuOpen(runtime, false);
  setEditMenuOpen(runtime, false);
  if (normalizedTarget === currentType) return true;
  let eligibility = pageTypesModel.conversionEligibility(runtime.currentPage, normalizedTarget);
  if (!eligibility.allowed) {
    showRuntimeStatus(runtime, eligibility.reasons[0] || 'This Page cannot be converted without migrating content.', true);
    return false;
  }
  commitFocusedMarkdownEditor();
  prepareInfoPanelsForRuntimeContextChange?.(runtime);
  saveActiveTabViewState(runtime);
  markdownPageMutationLocks.add(pageId);
  let lockedHnSession = null;
  if (currentType === markdownPageModel.PAGE_TYPES.MARKDOWN) {
    refreshMarkdownPageViews(pageId);
    setMarkdownPageConversionReadOnly(pageId, true);
  }
  showRuntimeStatus(runtime, 'Converting Page…');
  try {
    const pendingTitle = pageTitleSaveQueues.get(pageId);
    if (pendingTitle) await pendingTitle;
    if (!runtimeOperationIsCurrent(operation)) return false;
    if (currentType === markdownPageModel.PAGE_TYPES.MARKDOWN) {
      const saved = await flushMarkdownBodyPageNow(pageId);
      if (!runtimeOperationIsCurrent(operation)) return false;
      if (!saved) {
        showRuntimeStatus(runtime, 'Markdown text must finish saving before Page Type conversion.', true);
        return false;
      }
      const latestPage = canonicalPages.get(pageId) || sourcePage;
      eligibility = pageTypesModel.conversionEligibility(latestPage, normalizedTarget);
      if (!eligibility.allowed) {
        showRuntimeStatus(runtime, eligibility.reasons[0] || 'This Page cannot be converted without migrating content.', true);
        return false;
      }
    } else if (currentType === pageTypesModel.PAGE_TYPES.HN_TEXT) {
      globalThis.hnTextPageView?.commitFocusedHnTextEditor?.();
      const prepared = await lockAndFlushHnPageDocumentSessionForConversion(pageId, runtime);
      if (!runtimeOperationIsCurrent(operation)) {
        unlockHnPageDocumentSessionAfterFailedConversion(prepared.session);
        return false;
      }
      if (!prepared.ok) return false;
      lockedHnSession = prepared.session;
      const latestPage = canonicalPages.get(pageId) || sourcePage;
      eligibility = pageTypesModel.conversionEligibility(latestPage, normalizedTarget);
      if (!eligibility.allowed) {
        showRuntimeStatus(runtime, eligibility.reasons[0] || 'This Page cannot be converted without migrating content.', true);
        return false;
      }
    }
    const savedPage = await request(`${pageApiUrl(pageId)}/type`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: normalizedTarget })
    });
    if (currentType === pageTypesModel.PAGE_TYPES.HN_TEXT) {
      try {
        await discardHnPageDocumentSessionAfterConversion(pageId);
      } catch (error) {
        // The server response is already authoritative. A stale view cleanup
        // callback must not prevent the converted Page from converging locally.
        handleHnSessionError(error, runtime);
      }
      lockedHnSession = null;
    } else if (currentType === pageTypesModel.PAGE_TYPES.MARKDOWN) {
      const markdownState = markdownBodySaveStates.get(pageId);
      if (markdownState?.timer) window.clearTimeout(markdownState.timer);
      markdownBodySaveStates.delete(pageId);
    }
    const ownerCurrent = runtimeOperationIsCurrent(operation);
    const canonical = commitCanonicalPage(savedPage, {
      originRuntime: ownerCurrent ? runtime : null
    });
    try {
      pageIndex = await request('/api/page-index');
    } catch {
      if (Array.isArray(pageIndex?.pages)) {
        pageIndex = {
          ...pageIndex,
          pages: pageIndex.pages.map((entry) => entry.id === savedPage.id
            ? {
                ...entry,
                type: savedPage.type,
                title: savedPage.title,
                updatedAt: savedPage.updatedAt || entry.updatedAt
              }
            : entry)
        };
      }
    }
    const pageEntry = pageIndex.pages.find((page) => page.id === savedPage.id) || null;
    for (const candidateRuntime of livingPaneRuntimes()) {
      if (candidateRuntime.session.activeTab()?.currentPageId === savedPage.id) {
        candidateRuntime.currentPageEntry = pageEntry;
      }
    }
    if (runtimeOperationIsCurrent(operation)) {
      runtime.currentPage = canonical;
      renderPage(runtime, canonical, { installCanonical: false });
      restoreActiveTabViewState(runtime);
    }
    renderPageList();
    scheduleHnSessionReferenceReconcile();
    if (runtimeOperationIsCurrent(operation)) {
      showRuntimeStatus(runtime, `Page Type: ${pageTypesModel.pageTypeLabel(normalizedTarget)}.`, false, 1800);
    }
    scheduleWorkspaceStateSave();
    return true;
  } catch (error) {
    if (runtimeOperationIsCurrent(operation)) showRuntimeStatus(runtime, error.message, true);
    return false;
  } finally {
    unlockHnPageDocumentSessionAfterFailedConversion(lockedHnSession);
    markdownPageMutationLocks.delete(pageId);
    const finalPage = canonicalPages.get(pageId) || sourcePage;
    if (pageTypesModel.normalizePageType(finalPage.type)
      === pageTypesModel.PAGE_TYPES.MARKDOWN) {
      setMarkdownPageConversionReadOnly(pageId, false);
      refreshMarkdownPageViews(pageId);
    }
  }
}

async function createNewPage({ runtime = null, parentFolderId = null } = {}) {
  if (!runtimeIsLive(runtime) || newPageButton.disabled) return;

  const createSequence = ++runtime.pageLoadSequence;
  let ownerTab = activeTab(runtime);
  const createOwnerIsCurrent = () => runtimeIsLive(runtime)
    && runtime.pageLoadSequence === createSequence
    && activeTab(runtime) === ownerTab;
  closePageMetaModal();
  closeAddLinkPopover(runtime);
  closePageContextMenu();
  setEditMenuOpen(runtime, false);
  if (runtime.blockEditMode) cancelBlockEdits(runtime);
  if (runtime.pageEditMode) cancelPageEdits(runtime);
  if (runtime.highlightEditDraft) cancelHighlightEdits(runtime);
  showRuntimeStatus(runtime, '');
  newPageButton.disabled = true;

  try {
    const created = await request('/api/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parentFolderId ? { parentFolderId } : {})
    });
    project = created.project;
    pageIndex = created.pageIndex;
    navigation = created.navigation;
    const navigationMotion = captureSidebarNavigationMutation({
      enteringItems: [{ type: 'page', id: created.page.id }]
    });
    await playSidebarNavigationMutation(navigationMotion);
    if (!createOwnerIsCurrent()) return;
    saveActiveTabViewState(runtime);
    const historyMode = activeTab(runtime)?.currentPageId ? 'preserve' : 'replace';
    if (activeTab(runtime)?.currentPageId) {
      ownerTab = animateTabStripLayoutChange(() => runtime.session.createTab(created.page.id));
    } else {
      renderTabStrip({ ensureActiveVisible: true });
    }
    const opened = await completePageOpen(runtime, created.pageEntry, created.page, { historyMode });
    if (!opened || !createOwnerIsCurrent() || runtime.currentPage?.id !== created.page.id) return;
    if (runtime === activePaneRuntime()) beginNewPageTitleEditor(runtime, created.page);
  } catch (error) {
    if (createOwnerIsCurrent()) showRuntimeStatus(runtime, error.message, true);
  } finally {
    newPageButton.disabled = false;
  }
}

async function createNewFolder({ parentFolderId = null } = {}) {
  if (!newFolderButton || newFolderButton.disabled) return;
  const runtime = activePaneRuntime();
  if (!runtime) return;

  closePageMetaModal();
  if (!runtime.linkPickMode) closeAddLinkPopover(runtime);
  closePageContextMenu();
  setEditMenuOpen(runtime, false);
  showRuntimeStatus(runtime, '');
  newFolderButton.disabled = true;

  try {
    const created = await request('/api/navigation/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parentFolderId ? { parentFolderId } : {})
    });
    navigation = created.navigation;
    const navigationMotion = captureSidebarNavigationMutation({
      enteringItems: [{ type: 'folder', id: created.folder.id }]
    });
    await playSidebarNavigationMutation(navigationMotion);
    startFolderRename(created.folder, { selectAll: true });
  } catch (error) {
    showRuntimeStatus(runtime, error.message, true);
  } finally {
    newFolderButton.disabled = false;
  }
}

async function confirmAddLinkNewPage(runtime) {
  if (!runtimeIsLive(runtime) || !runtime.currentPage || !runtime.addLinkTarget
    || runtime.addLinkSelection !== 'new-page' || runtime.addLinkInProgress) return;

  const linkTarget = runtime.addLinkTarget;
  const linkSelection = runtime.addLinkSelection;
  if (pageMetaModal?.runtime === runtime) closePageMetaModal();
  runtime.addLinkInProgress = true;
  addLinkConfirmButton.disabled = true;
  addLinkNewPageButton.disabled = true;
  showRuntimeStatus(runtime, 'Creating linked page…');
  const operation = captureRuntimeOperation(runtime, { scope: 'add-link-new-page' });

  try {
    const created = await request(pageApiUrl(
      operation.pageId,
      `/blocks/${encodeURIComponent(linkTarget.blockId)}/new-page-link`
    ), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkTypeId: addLinkTypeSelect.value || defaultLinkTypeId() })
    });

    project = created.project;
    pageIndex = created.pageIndex;
    navigation = created.navigation;
    renderPageList();
    if (!runtimeOperationIsCurrent(operation)) return;
    const sharedIntentCurrent = runtime === activePaneRuntime()
      && runtime.addLinkTarget === linkTarget
      && runtime.addLinkSelection === linkSelection;
    closeAddLinkPopover(runtime, { sharedPresentation: sharedIntentCurrent });
    const navigated = await navigateCurrentTabToPage(runtime, created.page.id, {
      resolvedPageEntry: created.pageEntry,
      resolvedPage: created.page
    });
    if (!navigated) return;
    const settledOperation = captureRuntimeOperation(runtime, {
      scope: 'add-link-new-page-settled', pageId: created.page.id
    });
    if (!runtimeOperationIsCurrent(settledOperation) || runtime !== activePaneRuntime()) return;
    beginNewPageTitleEditor(runtime, created.page);
    showRuntimeStatus(runtime, 'Linked page created', false, 1800);
  } catch (error) {
    if (runtimeOperationIsCurrent(operation)) showRuntimeStatus(runtime, error.message, true);
  } finally {
    if (runtimeOperationOwnerIsCurrent(operation)) runtime.addLinkInProgress = false;
    if (runtimeOperationIsCurrent(operation) && runtime === activePaneRuntime()) {
      addLinkNewPageButton.disabled = false;
      setAddLinkSelection(runtime, runtime.addLinkSelection);
    } else if (addLinkPopover.hidden) {
      addLinkNewPageButton.disabled = false;
    }
  }
}

async function confirmAddLinkExistingPage(runtime) {
  if (!runtimeIsLive(runtime) || !runtime.currentPage || !runtime.addLinkTarget
    || runtime.addLinkSelection !== 'existing-page' || runtime.addLinkInProgress) return;
  const linkTarget = runtime.addLinkTarget;
  const linkSelection = runtime.addLinkSelection;
  const linkPickMode = runtime.linkPickMode;
  const selectedTargetPageId = linkPickMode?.selectedTargetPageId;
  if (!selectedTargetPageId) {
    showRuntimeStatus(runtime, 'Select a target page first.', true, 1800);
    return;
  }

  if (pageMetaModal?.runtime === runtime) closePageMetaModal();
  runtime.addLinkInProgress = true;
  addLinkConfirmButton.disabled = true;
  addLinkExistingPageButton.disabled = true;
  addLinkNewPageButton.disabled = true;
  showRuntimeStatus(runtime, 'Saving link…');
  const operation = captureRuntimeOperation(runtime, { scope: 'add-link-existing-page' });

  try {
    const saved = await request(pageApiUrl(
      operation.pageId,
      `/blocks/${encodeURIComponent(linkTarget.blockId)}/page-link`
    ), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetPageId: selectedTargetPageId,
        linkTypeId: addLinkTypeSelect.value || defaultLinkTypeId()
      })
    });

    pageIndex = saved.pageIndex;
    const ownerCurrent = runtimeOperationIsCurrent(operation);
    const canonical = commitCanonicalPage(saved.page, {
      originRuntime: ownerCurrent ? runtime : null
    });
    navigation = saved.navigation;
    renderPageList();
    if (!runtimeOperationIsCurrent(operation)) return;
    runtime.currentPage = canonical;
    runtime.currentPageEntry = pageIndex.pages.find((page) => page.id === canonical.id);
    const sharedIntentCurrent = runtime === activePaneRuntime()
      && runtime.addLinkTarget === linkTarget
      && runtime.addLinkSelection === linkSelection
      && runtime.linkPickMode === linkPickMode;
    closeAddLinkPopover(runtime, { sharedPresentation: sharedIntentCurrent });
    renderBlockOverlays(runtime, canonical.blocks);
    renderRelations(runtime, canonical);
    showRuntimeStatus(runtime, 'Linked page', false, 1800);
  } catch (error) {
    if (runtimeOperationIsCurrent(operation)) showRuntimeStatus(runtime, error.message, true);
  } finally {
    if (runtimeOperationOwnerIsCurrent(operation)) runtime.addLinkInProgress = false;
    if (runtimeOperationIsCurrent(operation) && runtime === activePaneRuntime()) {
      addLinkExistingPageButton.disabled = false;
      addLinkNewPageButton.disabled = false;
      setAddLinkSelection(runtime, runtime.addLinkSelection);
      renderAddLinkExistingTarget(runtime);
    } else if (addLinkPopover.hidden) {
      addLinkExistingPageButton.disabled = false;
      addLinkNewPageButton.disabled = false;
    }
  }
}

function confirmAddLink(runtime) {
  if (!runtimeIsLive(runtime)) return;
  if (runtime.addLinkSelection === 'external') {
    confirmBlockExternalLink(runtime);
    return;
  }
  if (runtime.addLinkSelection === 'existing-page') {
    confirmAddLinkExistingPage(runtime);
    return;
  }
  confirmAddLinkNewPage(runtime);
}

function desktopAddFileAvailable() {
  return resourceLocationsModel.desktopAddFileAvailable(window.cneDesktop);
}

function desktopFileDropAvailable() {
  return resourceLocationsModel.desktopFileDropAvailable(window.cneDesktop);
}

async function addFilesToCurrentPage(runtime, droppedFiles = null, dropPoint = null) {
  if (!runtimeIsLive(runtime)) return;
  const isDrop = Array.isArray(droppedFiles);
  const desktopActionAvailable = isDrop
    ? desktopFileDropAvailable()
    : desktopAddFileAvailable();
  if (!runtime.currentPage
    || !pageTypesModel.pageTypeSupports(runtime.currentPage.type, 'file-import')
    || addFileInProgress || !desktopActionAvailable) return;
  closePageMetaModal();
  closeResourceContextMenu();
  if (runtime.blockEditMode) cancelBlockEdits(runtime);
  if (runtime.highlightEditDraft) cancelHighlightEdits(runtime);
  const importIntoPageEdit = runtime.pageEditMode;
  const existingVisualCount = (runtime.currentPage.objects || [])
    .filter((object) => isDisplayableObject(object) && isVisibleObject(object)).length;
  const canvasRect = runtime.dom.canvasArea.getBoundingClientRect();
  const hasDropPoint = isDrop
    && Number.isFinite(dropPoint?.clientX)
    && Number.isFinite(dropPoint?.clientY);
  const placementCenter = screenToWorld(runtime,
    hasDropPoint ? dropPoint.clientX : canvasRect.left + canvasRect.width / 2,
    hasDropPoint ? dropPoint.clientY : canvasRect.top + canvasRect.height / 2
  );
  if (markdownPageModel.normalizePageType(runtime.currentPage.type) === markdownPageModel.PAGE_TYPES.MARKDOWN) {
    const documentBounds = typeof getMarkdownDocumentBounds === 'function'
      ? getMarkdownDocumentBounds(runtime.dom.canvasStage)
      : null;
    if (documentBounds && !hasDropPoint) {
      placementCenter.x = documentBounds.right + 180;
      placementCenter.y = Math.max(120, placementCenter.y);
    }
  }
  addFileInProgress = true;
  addFileButton.disabled = true;
  showRuntimeStatus(runtime, isDrop ? 'Adding dropped files…' : 'Selecting files…');
  const operation = captureRuntimeOperation(runtime, {
    scope: 'add-files', requireMount: false
  });
  let mutationSucceeded = false;
  try {
    const saved = isDrop
      ? await window.cneDesktop.addDroppedFiles(operation.pageId, droppedFiles, {
        placementCenter, stageOnly: importIntoPageEdit
      })
      : await window.cneDesktop.addFiles(operation.pageId, {
        placementCenter, stageOnly: importIntoPageEdit
      });
    if (saved?.cancelled) {
      if (runtimeOperationIsCurrent(operation)) {
        showRuntimeStatus(runtime, 'Link cancelled', false, 1400);
      }
      return;
    }
    if (!saved?.ok) throw new Error(saved?.error || 'Original files could not be linked.');
    if (importIntoPageEdit) {
      if (!runtimeOperationIsCurrent(operation)) return;
      const importedObjects = saved.linked
        .map((result) => result?.item)
        .filter((item) => item && isDisplayableObject(item) && isVisibleObject(item));
      if (!importedObjects.length) {
        showRuntimeStatus(runtime, 'Page Edit can stage displayable image Objects only.', true, 2400);
        return;
      }
      const beforeSnapshot = clonePageEditSnapshot(runtime);
      const knownIds = new Set(runtime.draftPageObjects.map((object) => object.id));
      const addedObjects = [];
      for (const object of importedObjects) {
        const added = { ...object };
        const baseId = added.id;
        let suffix = 2;
        while (knownIds.has(added.id)) {
          added.id = `${baseId}_${suffix}`;
          suffix += 1;
        }
        knownIds.add(added.id);
        runtime.draftPageObjects.push(added);
        addedObjects.push(added);
      }
      const selectedObjectId = addedObjects[addedObjects.length - 1].id;
      renderCanvas(runtime, runtime.draftPageObjects, [], { fit: false });
      setSelectedPageObject(runtime, selectedObjectId);
      recordPageEditChange(runtime, beforeSnapshot, clonePageEditSnapshot(runtime), {
        undoSelection: null,
        redoSelection: selectedObjectId
      });
      showRuntimeStatus(runtime, importedObjects.length === 1 ? 'Image staged' : 'Images staged', false, 1800);
      return;
    }
    mutationSucceeded = true;
    pageIndex = saved.pageIndex;
    const ownerCurrent = runtimeOperationIsCurrent(operation);
    const canonical = commitCanonicalPage(saved.page, {
      originRuntime: ownerCurrent ? runtime : null
    });
    renderPageList();
    if (!ownerCurrent) return;
    runtime.currentPage = canonical;
    runtime.currentPageEntry = pageIndex.pages.find((page) => page.id === runtime.currentPage.id);
    const linkedVisualIds = saved.linked
      .filter((result) => result?.item && isDisplayableObject(result.item) && isVisibleObject(result.item))
      .map((result) => result.item.id);
    const entersPageEdit = linkedVisualIds.length > 1
      || (existingVisualCount > 0 && linkedVisualIds.length > 0);
    renderPage(runtime, runtime.currentPage, {
      resetCanvas: isDrop ? false : !entersPageEdit,
      installCanonical: false
    });
    if (entersPageEdit) {
      enterPageEditMode(runtime, { selectObjectId: linkedVisualIds[linkedVisualIds.length - 1] });
    }
    if (saved.refreshError) showRuntimeStatus(runtime, saved.refreshError, true);
    else showRuntimeStatus(runtime, saved.linked.length === 1 ? 'File added' : 'Files added', false, 1800);
  } catch (error) {
    if (mutationSucceeded) {
      console.error('[add-file:page-refresh-failed]', {
        source: isDrop ? 'drop' : 'picker',
        pageId: runtime.currentPage?.id || null,
        error: error.message
      });
      if (runtimeOperationIsCurrent(operation)) {
        showRuntimeStatus(runtime, 'Files were added, but the page could not be refreshed.', true);
      }
    } else if (runtimeOperationIsCurrent(operation)) {
      showRuntimeStatus(runtime, error.message || 'Files could not be added.', true);
    }
  } finally {
    addFileInProgress = false;
    const activeRuntime = activePaneRuntime();
    if (activeRuntime) {
      addFileButton.disabled = !activeRuntime.currentPage
        || !pageTypesModel.pageTypeSupports(activeRuntime.currentPage.type, 'file-import')
        || !desktopAddFileAvailable();
    }
  }
}

function droppedFiles(event) {
  return [...(event.dataTransfer?.files || [])];
}

function setDropTarget(element, active) {
  element.classList.toggle('is-drop-target', active);
}

function dataTransferHasFiles(dataTransfer) {
  if (!dataTransfer) return false;
  if (dataTransfer.files?.length) return true;
  return Array.from(dataTransfer.types || []).some((type) => String(type).toLowerCase() === 'files');
}

function bindImportDropTarget(runtimeOrResolver, element, importTarget) {
  const resolveRuntime = typeof runtimeOrResolver === 'function'
    ? runtimeOrResolver
    : () => runtimeOrResolver;
  const capturePageDrop = importTarget === 'canvas';
  element.addEventListener('dragenter', (event) => {
    const runtime = resolveRuntime();
    if (!runtimeIsLive(runtime) || !runtime.currentPage
      || !dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (!pageTypesModel.pageTypeSupports(runtime.currentPage.type, 'file-import')) {
      setDropTarget(element, false);
      return;
    }
    setDropTarget(element, true);
  }, capturePageDrop);

  element.addEventListener('dragover', (event) => {
    const runtime = resolveRuntime();
    if (!runtimeIsLive(runtime) || !runtime.currentPage
      || !dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    const canImport = pageTypesModel.pageTypeSupports(runtime.currentPage.type, 'file-import');
    event.dataTransfer.dropEffect = canImport && desktopFileDropAvailable() ? 'link' : 'none';
    if (!canImport) {
      setDropTarget(element, false);
      return;
    }
    setDropTarget(element, true);
  }, capturePageDrop);

  element.addEventListener('dragleave', (event) => {
    if (!element.contains(event.relatedTarget)) setDropTarget(element, false);
  }, capturePageDrop);

  element.addEventListener('drop', (event) => {
    const runtime = resolveRuntime();
    if (!runtimeIsLive(runtime) || !runtime.currentPage
      || !dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(element, false);
    if (!pageTypesModel.pageTypeSupports(runtime.currentPage.type, 'file-import')) {
      event.dataTransfer.dropEffect = 'none';
      return;
    }
    const files = droppedFiles(event);
    if (!files.length) return;
    if (desktopFileDropAvailable()) {
      addFilesToCurrentPage(runtime, files, {
        clientX: event.clientX,
        clientY: event.clientY
      });
      return;
    }
    showRuntimeStatus(runtime, 'Add File is available in the desktop app.', true);
  }, capturePageDrop);
}

function resourceContextForRuntime(runtime) {
  const target = resourceContextTarget;
  if (!runtimeIsLive(runtime) || target?.runtime !== runtime
    || !runtimeOperationIsCurrent(target.token)) return null;
  return target.resource || null;
}

async function toggleResourceVisibility(runtime) {
  const object = resourceContextForRuntime(runtime);
  if (!runtime?.currentPage || !object) return;
  if (!isDisplayableObject(object)) return;
  const pageId = runtime.currentPage.id;
  const operation = captureRuntimeOperation(runtime, {
    scope: 'resource-visibility',
    pageId,
    resourceId: object.id
  });
  const nextVisible = !isVisibleObject(object);
  closeResourceContextMenu();
  showRuntimeStatus(runtime, nextVisible ? 'Showing…' : 'Hiding…');

  try {
    const saved = await request(pageApiUrl(
      pageId,
      `/objects/${encodeURIComponent(object.id)}/visibility`
    ), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visible: nextVisible })
    });

    pageIndex = saved.pageIndex;
    const ownerCurrent = runtimeOperationIsCurrent(operation);
    const canonical = commitCanonicalPage(saved.page, {
      originRuntime: ownerCurrent ? runtime : null
    });
    renderPageList();
    if (ownerCurrent) {
      runtime.currentPage = canonical;
      runtime.currentPageEntry = pageIndex.pages.find((page) => page.id === pageId) || null;
      renderPage(runtime, canonical, { installCanonical: false });
      showRuntimeStatus(runtime, 'Saved', false, 1400);
    }
  } catch (error) {
    if (runtimeOperationIsCurrent(operation)) showRuntimeStatus(runtime, error.message, true);
  }
}

function isDesktopResourceActionAvailable(resource) {
  return desktopResourceClient.canUse(resource);
}

function applyManagedResourceRelocationToCurrentPage(runtime, relocation) {
  if (!runtimeIsLive(runtime) || !runtime.currentPage || !relocation?.location) return false;
  const changedIds = resourceLocationsModel.applyManagedResourceRelocation(
    runtime.currentPage,
    relocation
  );
  if (changedIds.length && runtime === activePaneRuntime()) {
    renderMaintenanceResources(runtime, runtime.currentPage);
  }
  return changedIds.length > 0;
}

async function runDesktopResourceAction(runtime, action, resource) {
  if (!runtimeIsLive(runtime)) return;
  if (!isDesktopResourceActionAvailable(resource)) return;
  const operation = captureRuntimeOperation(runtime, { scope: `resource-${action}` });
  closeResourceContextMenu();

  try {
    const result = action === 'open'
      ? await desktopResourceClient.open(resource)
      : await desktopResourceClient.reveal(resource);
    if (!runtimeOperationIsCurrent(operation)) return;
    if (!result?.ok) throw new Error(result?.error || 'The desktop resource action failed.');
    if (result.relocated) applyManagedResourceRelocationToCurrentPage(runtime, result);
    showRuntimeStatus(runtime, action === 'open' ? 'Opened' : 'Revealed in Finder', false, 1400);
  } catch (error) {
    if (runtimeOperationIsCurrent(operation)) {
      showRuntimeStatus(runtime, error.message || 'The desktop resource action failed.', true);
    }
  }
}

function openContextResourceInDesktop(runtime) {
  return openResourceInDesktop(runtime, resourceContextForRuntime(runtime));
}

function revealContextResourceInDesktop(runtime) {
  return revealResourceInDesktop(runtime, resourceContextForRuntime(runtime));
}

function openResourceInDesktop(runtime, resource) {
  return runDesktopResourceAction(runtime, 'open', resource);
}

function revealResourceInDesktop(runtime, resource) {
  return runDesktopResourceAction(runtime, 'reveal', resource);
}

async function deleteContextResource(runtime) {
  const resource = resourceContextForRuntime(runtime);
  if (!runtime?.currentPage || !resource || resourceDeleteInProgress) return;
  const pageId = runtime.currentPage.id;
  const attachedBlocks = isDisplayableObject(resource)
    ? (runtime.currentPage.blocks || []).filter((block) => block.objectId === resource.id)
    : [];
  const attachedLinkCount = attachedBlocks.reduce(
    (count, block) => count + getBlockLinks(block).length,
    0
  );
  const fileRetentionNote = ' The target file will remain untouched.';
  if ((attachedBlocks.length || attachedLinkCount)
    && !window.confirm(
      `Delete ${itemLabel(resource)}? Its ${plural(attachedBlocks.length, 'attached block')}`
      + ` and ${plural(attachedLinkCount, 'link')} will also be removed.${fileRetentionNote}`
    )) {
    closeResourceContextMenu();
    return;
  }

  resourceDeleteInProgress = true;
  const operation = captureRuntimeOperation(runtime, {
    scope: 'resource-delete',
    pageId,
    resourceId: resource.id
  });
  let deleted;
  try {
    closeResourceContextMenu();
    showRuntimeStatus(runtime, 'Deleting resource…');
    deleted = await request(pageApiUrl(
      pageId,
      `/resources/${encodeURIComponent(resource.id)}`
    ), { method: 'DELETE' });
  } catch (error) {
    if (runtimeOperationIsCurrent(operation)) showRuntimeStatus(runtime, error.message, true);
    resourceDeleteInProgress = false;
    return;
  }

  try {
    pageIndex = deleted.pageIndex;
    navigation = deleted.navigation;
    const ownerCurrent = runtimeOperationIsCurrent(operation);
    const canonical = commitCanonicalPage(deleted.page, {
      originRuntime: ownerCurrent ? runtime : null
    });
    renderPageList();
    if (ownerCurrent) {
      runtime.currentPage = canonical;
      runtime.currentPageEntry = pageIndex.pages.find((page) => page.id === pageId) || null;
      renderPage(runtime, canonical, {
        resetCanvas: deleted.deletedKind === 'object', installCanonical: false
      });
      if (deleted.deletedKind !== 'object') {
        renderBlockOverlays(runtime, runtime.currentPage.blocks);
      }
      showRuntimeStatus(runtime, deleted.warnings?.length
        ? `Deleted with warning: ${deleted.warnings[0]}`
        : 'Deleted', Boolean(deleted.warnings?.length), 2200);
    }
  } catch (error) {
    if (runtimeOperationIsCurrent(operation)) {
      showRuntimeStatus(runtime, `Deleted, but refresh failed: ${error.message}`, true);
    }
  } finally {
    resourceDeleteInProgress = false;
  }
}

async function deleteContextPage(runtime, { pageIds = null, navigationItems = null } = {}) {
  if (!runtimeIsLive(runtime)) return;
  const selectedItems = Array.isArray(navigationItems) ? navigationItems : [];
  const requestedPageIds = [
    ...(Array.isArray(pageIds) ? pageIds : []),
    ...selectedItems.filter((item) => item?.type === 'page').map((item) => item.id)
  ];
  if (!requestedPageIds.length && pageContextTarget?.id) requestedPageIds.push(pageContextTarget.id);
  const targetPageIds = [...new Set(
    requestedPageIds
      .filter((pageId) => pageIndex.pages.some((page) => page.id === pageId))
  )];
  const selectedFolderIds = [...new Set(
    selectedItems.filter((item) => item?.type === 'folder').map((item) => item.id)
  )];
  const selectedFolders = selectedFolderIds
    .map((folderId) => navigationFolderById(folderId))
    .filter((folder) => folder?.type === 'manual' && folder.source?.kind === 'manual');
  const folderContainsFolderId = (folder, folderId) => (folder.children || []).some((child) => (
    child.id === folderId || folderContainsFolderId(child, folderId)
  ));
  const foldersToDelete = selectedFolders.filter((folder) => !selectedFolders.some((candidate) => (
    candidate.id !== folder.id && folderContainsFolderId(candidate, folder.id)
  )));
  if (!targetPageIds.length && !foldersToDelete.length) return;
  if (pageDeleteInProgress || (foldersToDelete.length && folderDeleteInProgress)) return;
  const operation = captureRuntimeOperation(runtime, { scope: 'page-delete' });
  const originalPageId = operation?.pageId || null;
  pageDeleteInProgress = true;
  if (foldersToDelete.length) folderDeleteInProgress = true;

  try {
    const targetPages = await Promise.all(targetPageIds.map((pageId) => request(pageApiUrl(pageId))));
    const counts = targetPages.reduce((total, page) => {
      const pageCounts = pageDeleteCounts(page);
      total.objects += pageCounts.objects;
      total.blocks += pageCounts.blocks;
      total.relatedLinks += pageCounts.relatedLinks;
      return total;
    }, { objects: 0, blocks: 0, relatedLinks: 0 });
    if (runtimeOperationIsCurrent(operation)) {
      closePageContextMenu();
      closeFolderContextMenu();
    }

    const selectedItemCount = targetPageIds.length + selectedFolders.length;
    const confirmationRequired = selectedItemCount > 1 || hasDeletableContent(counts);
    let confirmationMessage = targetPageIds.length > 1
      ? `Delete ${targetPageIds.length} selected pages, ${plural(counts.objects, 'object')}, `
        + `${plural(counts.blocks, 'block')}, and ${plural(counts.relatedLinks, 'related link')}?`
      : deleteConfirmationMessage(counts);
    if (selectedFolders.length) {
      const parts = [];
      if (targetPageIds.length) parts.push(plural(targetPageIds.length, 'selected page'));
      parts.push(plural(selectedFolders.length, 'selected folder'));
      const content = targetPageIds.length
        ? `, ${plural(counts.objects, 'object')}, ${plural(counts.blocks, 'block')}, `
          + `and ${plural(counts.relatedLinks, 'related link')}`
        : '';
      confirmationMessage = `Delete ${parts.join(' and ')}${content}? `
        + 'Pages inside selected folders that are not selected will remain in the Vault.';
    }
    if (confirmationRequired && !window.confirm(confirmationMessage)) {
      return;
    }

    if (runtimeOperationIsCurrent(operation)) {
      if (runtime.blockEditMode) cancelBlockEdits(runtime);
      if (runtime.pageEditMode) cancelPageEdits(runtime);
      if (runtime.highlightEditDraft) cancelHighlightEdits(runtime);
      if (pageMetaModal?.runtime === runtime) closePageMetaModal();
      showRuntimeStatus(runtime, 'Deleting…');
    }
    let deleted = null;
    for (const pageId of targetPageIds) {
      deleted = await request(pageApiUrl(pageId), { method: 'DELETE' });
      project = deleted.project;
      pageIndex = deleted.pageIndex;
      navigation = deleted.navigation;
    }
    for (const folder of foldersToDelete) {
      const deletedFolder = await request(
        `/api/navigation/folders/${encodeURIComponent(folder.id)}`,
        { method: 'DELETE' }
      );
      navigation = deletedFolder.navigation;
    }

    const navigationMotion = captureSidebarNavigationMutation({
      exitingItems: [
        ...targetPageIds.map((id) => ({ type: 'page', id })),
        ...foldersToDelete.map((folder) => ({ type: 'folder', id: folder.id }))
      ]
    });
    for (const paneRuntime of livingPaneRuntimes()) updatePageHistoryButtons(paneRuntime);
    clearNavigationSelection();
    await playSidebarNavigationMutation(navigationMotion);

    if (!runtimeOperationIsCurrent(operation)) return;
    if (originalPageId && targetPageIds.includes(originalPageId)) {
      const fallbackPageId = project.lastOpenedPageId || deleted.fallbackPageId;
      const fallbackPage = fallbackPageId
        ? pageIndex.pages.find((pageEntry) => pageEntry.id === fallbackPageId)
        : null;

      if (fallbackPage) {
        if (!await navigateCurrentTabToPage(runtime, fallbackPage.id)) return;
      } else renderNoPage('No pages are available.');
    } else if (originalPageId) {
      const currentEntry = pageIndex.pages.find((pageEntry) => pageEntry.id === originalPageId);
      if (currentEntry) {
        if (!await loadPage(runtime, currentEntry, { historyMode: 'preserve' })) return;
      }
      else renderNoPage('No pages are available.');
    }

    if (runtimeIsLive(runtime)) showRuntimeStatus(runtime, 'Deleted', false, 1800);
  } catch (error) {
    if (runtimeOperationIsCurrent(operation)) showRuntimeStatus(runtime, error.message, true);
  } finally {
    pageDeleteInProgress = false;
    if (foldersToDelete.length) folderDeleteInProgress = false;
  }
}

async function deleteContextFolder() {
  if (!folderContextTarget || folderDeleteInProgress) return;
  const runtime = activePaneRuntime();
  if (!runtime) return;
  const operation = captureRuntimeOperation(runtime, { scope: 'folder-delete' });
  const originalPageId = operation?.pageId || null;
  const folder = folderContextTarget;
  folderDeleteInProgress = true;

  try {
    closeFolderContextMenu();
    const decision = await confirmFolderDelete(folder);
    if (!decision.confirmed) return;

    const pageIds = [...new Set(collectFolderPageIds(folder))];
    const currentPageWillDelete = decision.deletePages && originalPageId
      && pageIds.includes(originalPageId);
    let fallbackPageId = null;

    if (runtimeOperationIsCurrent(operation)) showRuntimeStatus(runtime, 'Deleting folder…');
    if (decision.deletePages) {
      for (const pageId of pageIds) {
        const deleted = await request(pageApiUrl(pageId), { method: 'DELETE' });
        project = deleted.project;
        pageIndex = deleted.pageIndex;
        navigation = deleted.navigation;
        if (originalPageId === deleted.deletedPageId) fallbackPageId = deleted.fallbackPageId;
      }
    }

    const deletedFolder = await request(`/api/navigation/folders/${encodeURIComponent(folder.id)}`, {
      method: 'DELETE'
    });
    navigation = deletedFolder.navigation;
    clearNavigationSelection();
    if (decision.deletePages) {
      project = await request('/api/project');
      for (const paneRuntime of livingPaneRuntimes()) updatePageHistoryButtons(paneRuntime);
    }
    const navigationMotion = captureSidebarNavigationMutation({
      exitingItems: [
        { type: 'folder', id: folder.id },
        ...(decision.deletePages
          ? pageIds.map((id) => ({ type: 'page', id }))
          : [])
      ]
    });
    await playSidebarNavigationMutation(navigationMotion);

    if (!runtimeOperationIsCurrent(operation)) return;
    if (currentPageWillDelete) {
      const fallbackPage = fallbackPageId
        ? pageIndex.pages.find((pageEntry) => pageEntry.id === fallbackPageId)
        : null;
      if (fallbackPage) {
        if (!await navigateCurrentTabToPage(runtime, fallbackPage.id)) return;
      }
      else renderNoPage('No pages are available.');
    } else if (originalPageId) {
      const currentEntry = pageIndex.pages.find((pageEntry) => pageEntry.id === originalPageId);
      if (currentEntry) {
        const refreshedPage = await request(pageApiUrl(currentEntry.id));
        if (!runtimeOperationIsCurrent(operation)) return;
        renderPage(runtime, refreshedPage, { resetCanvas: false });
        renderBlockOverlays(runtime, refreshedPage.blocks);
      }
    }

    if (runtimeIsLive(runtime)) showRuntimeStatus(runtime, 'Folder deleted', false, 1800);
  } catch (error) {
    if (runtimeOperationIsCurrent(operation)) showRuntimeStatus(runtime, error.message, true);
  } finally {
    folderDeleteInProgress = false;
  }
}

async function deleteContextRelation(runtime) {
  const context = relationContextTarget;
  if (!runtimeIsLive(runtime) || context?.runtime !== runtime
    || !runtimeOperationIsCurrent(context.token) || relationDeleteInProgress) return;
  const operation = context.token;
  const relation = context.relation;
  const instances = relation.instances?.length ? relation.instances : [relation];
  relationDeleteInProgress = true;

  try {
    closeRelationContextMenu();
    setRelationHoverBlocks(runtime, instances, false);
    showRuntimeStatus(runtime, 'Deleting link…');
    let deleted = null;
    const seen = new Set();
    for (const instance of instances) {
      const key = `${instance.sourcePageId}|${instance.sourceBlockId}|${instance.sourceLinkId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deleted = await request(pageApiUrl(
        instance.sourcePageId,
        `/blocks/${encodeURIComponent(instance.sourceBlockId)}/links/${encodeURIComponent(instance.sourceLinkId)}`
      ), { method: 'DELETE' });
    }
    if (!deleted) return;

    pageIndex = deleted.pageIndex;
    navigation = deleted.navigation;
    renderPageList();

    if (runtimeOperationIsCurrent(operation)) {
      const pageId = operation.pageId;
      const refreshedPage = pageId === deleted.page.id
        ? deleted.page
        : await request(pageApiUrl(pageId));
      if (!runtimeOperationIsCurrent(operation)) return;
      runtime.currentPageEntry = pageIndex.pages.find((page) => page.id === refreshedPage.id);
      renderPage(runtime, refreshedPage, { resetCanvas: false, installCanonical: false });
      renderBlockOverlays(runtime, refreshedPage.blocks);
      showRuntimeStatus(runtime, 'Link deleted', false, 1600);
    }
  } catch (error) {
    if (runtimeOperationIsCurrent(operation)) showRuntimeStatus(runtime, error.message, true);
  } finally {
    relationDeleteInProgress = false;
  }
}
