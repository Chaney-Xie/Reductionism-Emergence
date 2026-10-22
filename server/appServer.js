const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { createDescriptorModel } = require('./descriptorModel');
const {
  buildPageMetadataProjection,
  createDescriptorMetadataCommit,
  metadataRevisionStatus
} = require('./descriptorMetadataCommit');
const { createImportService } = require('./importService');
const {
  cloneJson,
  deleteFile,
  deleteJson,
  readJson,
  readJsonIfExists,
  withJsonWriteTransaction,
  writeFileTransactional,
  writeJson,
  writeJsonAtomic
} = require('./jsonStore');
const { createLinkModel } = require('./linkModel');
const {
  createLinkedResourceService,
  desktopMutationAuthorized,
  mimeTypeForResource,
  resourceContentHeaders,
  resourceContentIsFresh
} = require('./linkedResourceService');
const { createNavigationModel } = require('./navigationModel');
const NavigationProjection = require('./navigationProjection');
const { createPageStore } = require('./pageStore');
const {
  createResourceService,
  unlinkAllPageResources,
  unlinkPageResource
} = require('./resourceService');
const {
  loadDescriptorSyncIndex,
  saveDescriptorSyncIndex,
  validateDescriptorSyncIndex
} = require('../descriptorSyncIndex');
const {
  validateQueueEvaluator
} = require('../descriptorSyncPlanner');
const {
  normalizeDescriptorGroups,
  remapMemberships,
  removeMemberships,
  validateDescriptorGroups
} = require('../public/descriptorGroups');
const {
  normalizeResourceLocation,
  withResourceLocation
} = require('../public/resourceLocations');
const {
  normalizeExternalLinks,
  validateDraft: validateExternalLinkDraft
} = require('../public/externalLinks');
const {
  normalizeBlockColourPresetId,
  normalizeAppearanceSettings,
  normalizeHexColour,
  validateAppearanceSettings
} = require('../public/appearanceSettings');
const { planHnTextRevisionSave } = require('./hnTextPage');
const {
  normalizeHnTextMode,
  validateHnTextMode
} = require('../public/hnText');
const pageTypesModel = require('../public/pageTypes');
const {
  normalizeMarkdownMode,
  normalizePreserveSingleLineBreaks,
  validateMarkdownMode,
  validatePreserveSingleLineBreaks
} = require('../public/markdownPage');
const {
  PAGE_TYPES,
  conversionEligibility,
  convertPage,
  createPageRecord,
  normalizePageIndexEntry,
  normalizePageRecord,
  normalizePageType,
  pageTypeDefinition,
  pageTypeSupports,
  pageTypesForMenu,
  registeredPartialSaveFields,
  validatePageTypePartialSave,
  validatePageRecord,
  validateVaultDefaultPageType
} = pageTypesModel;
const categoryBatch = require('../public/categoryBatch');
const categoryNavigation = require('../public/categoryNavigation');
const { applicationDataRoot } = require('./vaultContext');
const {
  migrateVaultWorkspaceStateLastOpenedPage,
  migrateVaultWorkspaceStateStructuredTextFrames,
  readVaultWorkspaceState,
  removePageViewStateFromVaultWorkspaceState,
  updateVaultWorkspaceState
} = require('./vaultWorkspaceState');

function requireContextPath(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} is required to create a Vault server context.`);
  }
  return path.resolve(value);
}

function createVaultServerContext({
  appRoot,
  vaultId,
  vaultRoot,
  resourceResolver = null,
  displayProxyService = null,
  desktopMutationToken = null
} = {}) {
  if (typeof vaultId !== 'string' || !vaultId.trim()) {
    throw new TypeError('Vault ID is required to create a Vault server context.');
  }

const app = express();
const APP_ROOT = requireContextPath(appRoot, 'Application root');
const VAULT_ROOT = requireContextPath(vaultRoot, 'Vault root');
const DATA_DIR = VAULT_ROOT;
const PAGES_DIR = path.join(DATA_DIR, 'pages');
const ASSETS_DIR = path.join(VAULT_ROOT, 'assets');
const IMAGE_ASSETS_DIR = path.join(ASSETS_DIR, 'images');
const RESOURCE_ASSETS_DIR = path.join(ASSETS_DIR, 'resources');
const DESCRIPTOR_SYNC_INDEX_PATH = path.join(DATA_DIR, 'descriptorSyncIndex.json');
const DESCRIPTOR_GROUPS_PATH = path.join(DATA_DIR, 'descriptorGroups.json');
const VAULT_METADATA_PATH = path.join(DATA_DIR, 'vault.json');
const APPEARANCE_PATH = path.join(DATA_DIR, 'appearance.json');
const NAVIGATION_PATH = path.join(DATA_DIR, 'navigation.json');
let configuredResourceResolver = typeof resourceResolver === 'function'
  ? resourceResolver
  : null;
let configuredDesktopMutationToken = typeof desktopMutationToken === 'string'
  && desktopMutationToken.length >= 16
  ? desktopMutationToken
  : null;
let configuredDisplayProxyService = displayProxyService
  && typeof displayProxyService.prepareContent === 'function'
  ? displayProxyService
  : null;
// Page mutations are serialized as one canonical transaction stream. Several
// Page operations update more than their URL's Page (backlinks, category
// batches) and nearly all of them also update the shared pageIndex. A per-ID
// queue cannot protect those secondary writes.
let pageMutationQueue = Promise.resolve();
let vaultPreferenceMutationQueue = Promise.resolve();
let activeServer = null;
let lifecycleState = 'idle';
let startPromise = null;
let closePromise = null;
const PAGE_MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SERIALIZED_GET_PATHS = new Set([
  '/api/navigation',
  '/api/link-types',
  '/api/page-index',
  '/api/descriptors',
  '/api/descriptor-groups',
  '/api/descriptor-sync-rules',
  '/api/descriptor-sync-index/validate',
  '/api/descriptor-sync-index/evaluate',
  '/api/descriptor-metadata/snapshot',
  '/api/vocabulary'
]);
const SERIALIZED_MUTATION_COMPLETE = Symbol('serializedMutationComplete');
const SERIALIZED_MUTATION_OWNS_COMPLETION = Symbol('serializedMutationOwnsCompletion');

function requestNeedsPageSerialization(req) {
  if (PAGE_MUTATION_METHODS.has(req.method)) return true;
  if (req.method !== 'GET') return false;
  const pathname = String(req.originalUrl || '').split('?')[0].replace(/\/+$/, '');
  if (SERIALIZED_GET_PATHS.has(pathname)) return true;
  // Page reads join the stream only as a barrier so they observe one coherent
  // committed snapshot. They normalize their response in memory and do not
  // publish repair writes. Nested resource-content GETs remain streaming reads.
  return /^\/api\/pages\/[^/]+$/.test(pathname);
}

function serializePageMutation(req, res, next) {
  if (!requestNeedsPageSerialization(req)) return next();
  const previous = pageMutationQueue;
  let release;
  const completion = new Promise((resolve) => { release = resolve; });
  let complete = false;
  let started = false;
  const finish = () => {
    if (complete) return;
    complete = true;
    req.off('aborted', cancelBeforeStart);
    res.off('finish', finishFromResponse);
    res.off('close', cancelBeforeStart);
    release();
  };
  const cancelBeforeStart = () => {
    // Once a handler has started, losing its client does not cancel its file
    // writes. Keep the queue held until that handler reaches its own terminal
    // boundary so a later mutation cannot be overwritten by abandoned work.
    if (!started) finish();
  };
  const finishFromResponse = () => {
    if (!req[SERIALIZED_MUTATION_OWNS_COMPLETION]) finish();
  };
  req[SERIALIZED_MUTATION_COMPLETE] = finish;
  req.once('aborted', cancelBeforeStart);
  res.once('finish', finishFromResponse);
  res.once('close', cancelBeforeStart);

  // Express does not await async route handlers. For ordinary mutation routes,
  // the terminal response attempt is therefore the only observable completion
  // boundary after an active socket has closed. Transactional routes override
  // this and release explicitly from their awaited finally block.
  const originalEnd = res.end;
  res.end = function serializedMutationEnd(...args) {
    try {
      return originalEnd.apply(this, args);
    } finally {
      if (started && !req[SERIALIZED_MUTATION_OWNS_COMPLETION]) finish();
    }
  };
  const current = previous.catch(() => {}).then(() => {
    if (complete || req.aborted || res.destroyed || res.writableEnded) {
      finish();
      return undefined;
    }
    started = true;
    try {
      next();
    } catch (error) {
      finish();
      next(error);
      return undefined;
    }
    return completion;
  });
  pageMutationQueue = current.catch(() => {});
  return undefined;
}

function transactionalJsonRoute(handler) {
  return async (req, res, next) => {
    let passThrough = false;
    req[SERIALIZED_MUTATION_OWNS_COMPLETION] = true;
    try {
      await withJsonWriteTransaction(async () => {
        await handler(req, res, (error) => {
          if (error) throw error;
          passThrough = true;
        });
      });
      if (passThrough) next();
    } catch (error) {
      next(error);
    } finally {
      req[SERIALIZED_MUTATION_COMPLETE]?.();
    }
  };
}

const samples = {
  'vault.json': {
    vaultId: 'vault_default',
    displayName: 'Default Vault',
    schemaVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    defaultManagedResourceLocation: {
      type: 'vault',
      imageRoot: 'assets/images',
      resourceRoot: 'assets/resources'
    },
    defaultPageType: PAGE_TYPES.CANVAS,
    lastMarkdownMode: 'live-preview',
    cneTextMode: 'edit',
    preserveSingleLineBreaks: false
  },
  'appearance.json': null,
  'workspaceState.json': {
    schemaVersion: 1,
    lastOpenedPageId: null,
    workspaceState: null
  },
  'pageIndex.json': {
    metadataRevision: 0,
    pages: []
  },
  'navigation.json': {
    version: 3,
    folders: [
      {
        id: 'folder_uncategorised',
        label: 'Uncategory',
        type: 'system',
        pinned: true,
        collapsed: true,
        defaultPageId: null,
        pinnedPageIds: [],
        pageOrder: [],
        source: { kind: 'missingCategories' }
      }
    ],
    items: [],
    pageStates: {},
    bindings: []
  },
  'categories.json': {
    navigation: {
      enabledCategoryIds: [],
      collapseUncategorisedPages: true,
      quantityStatistics: false
    },
    groups: [
      {
        id: 'level',
        label: 'Level',
        children: [
          { type: 'item', id: 'level_global', label: 'Global' },
          { type: 'item', id: 'level_local', label: 'Local' },
          { type: 'item', id: 'level_single_process', label: 'SingleProcess' },
          { type: 'item', id: 'level_terminal', label: 'Terminal' }
        ]
      },
      {
        id: 'content',
        label: 'Content',
        children: [
          { type: 'item', id: 'content_foundation', label: 'Foundation' },
          { type: 'item', id: 'content_core', label: 'Core' },
          { type: 'item', id: 'content_tool', label: 'Tool' },
          { type: 'item', id: 'content_new', label: 'New' },
          { type: 'item', id: 'content_assistant', label: 'Assistant' }
        ]
      }
    ]
  },
  'vocabulary.json': {
    version: 1,
    entries: []
  },
  'descriptors.json': {
    version: 1,
    metadataRevision: 0,
    classes: [
      { id: 'class_1', label: 'Class 1' },
      { id: 'class_2', label: 'Class 2' },
      { id: 'class_3', label: 'Class 3' }
    ],
    groups: [
      { id: 'ungrouped', label: 'Ungrouped', children: [] }
    ],
    entries: []
  },
  'descriptorSyncIndex.json': {
    schemaVersion: 1,
    metadataRevision: 0,
    pages: {}
  },
  'descriptorGroups.json': {
    version: 1,
    groups: {},
    descriptorParentByEntryId: {}
  },
  'workspaces.json': {
    version: 1,
    workspaces: {}
  },
  'descriptorSyncRules.json': {
    rules: [
      {
        id: 'preset_class1_write_contains_class1',
        enabled: true,
        localClassId: 'class_1',
        mode: 'write',
        linkTypeId: 'contains',
        remoteClassId: 'class_1'
      },
      {
        id: 'preset_class2_write_contains_class1',
        enabled: true,
        localClassId: 'class_2',
        mode: 'write',
        linkTypeId: 'contains',
        remoteClassId: 'class_1'
      },
      {
        id: 'preset_class2_write_weak_contains_class3',
        enabled: true,
        localClassId: 'class_2',
        mode: 'write',
        linkTypeId: 'weak_contains',
        remoteClassId: 'class_3'
      },
      {
        id: 'preset_class3_read_contains_class2',
        enabled: true,
        localClassId: 'class_3',
        mode: 'read',
        linkTypeId: 'contains',
        remoteClassId: 'class_2'
      },
      {
        id: 'preset_class2_write_horizontal_class3',
        enabled: true,
        localClassId: 'class_2',
        mode: 'write',
        linkTypeId: 'horizontal',
        remoteClassId: 'class_3'
      }
    ]
  },
  'linkTypes.json': {
    linkTypes: [
      { id: 'contains', label: 'contain', opposite: 'contained_by' },
      { id: 'contained_by', label: 'contained by', opposite: 'contains' },
      { id: 'weak_contains', label: '[weak] contain', opposite: 'weak_contained_by' },
      { id: 'weak_contained_by', label: '[weak] contained by', opposite: 'weak_contains' },
      { id: 'horizontal', label: 'horizontal', opposite: 'horizontal' }
    ],
    defaultLinkTypeId: 'contains'
  }
};

const descriptorModel = createDescriptorModel(samples);
const {
  clearIgnoredManualOverrides,
  descriptorClasses,
  descriptorCompareKey,
  descriptorEntryByText,
  descriptorEntryByVocabulary,
  emptyPageDescriptorGroups,
  flattenedDescriptorIds,
  getOrCreateDescriptorEntry,
  getOrCreateVocabularyEntry,
  isSubsetStringSet,
  materializeDescriptorDraftDefinitions,
  normalizeDescriptorLibrary,
  normalizeDescriptorOrigins,
  normalizeDescriptorText,
  normalizeIgnoredDescriptors,
  normalizeIgnoredManualEntryIds,
  normalizePageDescriptorGroups,
  normalizeVocabularyLibrary,
  pageIndexDescriptorGroups,
  remapDescriptorIdsInGroups,
  removeDescriptorIdsFromIgnored,
  removeDescriptorIdsFromPageDescriptors,
  saveDescriptorDraft,
  uniqueDescriptorEntryId,
  uniqueVocabularyEntryId,
  validateVocabularyLibrary,
  vocabularyEntryByText,
  vocabularyTextOwners
} = descriptorModel;


const {
  auditOrphanPageFiles: auditOrphanPageFilesFromIndex,
  findPageJsonPath,
  pageDateStamp,
  relativeDataPath,
  safePageFilePath,
  safePageFilePathFromId
} = createPageStore({ dataDir: DATA_DIR, pagesDir: PAGES_DIR });

const {
  addFollowers,
  bindingForPage,
  cleanupBindingForDeletedPage,
  collectFolderPageIds,
  createBinding,
  dissolveBinding,
  findFolderLocation,
  findManualPageLocation,
  flattenFolders,
  folderContainsFolder,
  makeUniqueFolderLabel,
  makeUniquePageTitle,
  manualFolderPageIds,
  persistNavigationMove,
  normalizeNavigation,
  pageStickOnTop,
  removeFollower,
  removeFolderById,
  removePageFromManualFolders,
  resolveFolderPageIds,
  setBindingLeader,
  setPageStickOnTop,
  uniqueDatedFolderId,
  uniqueDatedPageId,
  uniqueUntitledTitle
} = createNavigationModel({ pagesDir: PAGES_DIR, pageDateStamp });

const {
  deletePageDestructionObjectFiles,
  localAssetFilePath
} = createResourceService({
  root: VAULT_ROOT,
  safePageFilePath,
  readJson,
  deletePageOwnedFile: deleteFile
});

const {
  cleanupDuplicateImportedItems,
  detectImportedFileType,
  idPageSuffix,
  importFileToPage,
  linkOriginalFilesToPage,
  normalizeImportedFilename,
  parseMultipartRequest,
  repairImportedImageDisplaySizes
} = createImportService({
  imageAssetsDir: IMAGE_ASSETS_DIR,
  resourceAssetsDir: RESOURCE_ASSETS_DIR,
  localAssetFilePath,
  writeFile: writeFileTransactional
});

function requireConfiguredResourceResolver() {
  if (typeof configuredResourceResolver === 'function') return configuredResourceResolver;
  const error = new Error('Linked original files are available in the desktop app.');
  error.code = 'WORKSPACE_UNAVAILABLE';
  throw error;
}

function linkedResourceHttpError(error) {
  if (error.code === 'RESOURCE_NOT_FOUND') return { status: 404, message: 'Resource not found.' };
  if (error.code === 'ENOENT' || error.code === 'NOT_FOUND' || error.code === 'FILE_NOT_FOUND') {
    return { status: 404, message: 'File not found.' };
  }
  if (['WORKSPACE_UNMAPPED', 'WORKSPACE_UNAVAILABLE', 'FOLDER_UNMAPPED'].includes(error.code)) {
    return { status: 503, message: error.message };
  }
  if (['PATH_TRAVERSAL', 'SYMLINK_ESCAPE', 'ABSOLUTE_PATH', 'INVALID_LOCATION',
    'INVALID_WORKSPACE', 'UNKNOWN_WORKSPACE', 'INVALID_FOLDER', 'UNKNOWN_FOLDER',
    'NOT_A_FILE'].includes(error.code)) {
    return { status: 403, message: error.message };
  }
  return null;
}

const {
  backlinkFromLink,
  backlinkKey,
  dedupeBacklinks,
  linkTypeById,
  oppositeLinkTypeId,
  pageLinkRefs,
  removeBacklinksBySource,
  removeIncomingLinkFromSource,
  removeLinksToTargetPage,
  uniqueBlockPageLinkId,
  validBacklink
} = createLinkModel({
  defaultLinkTypes: samples['linkTypes.json'],
  idPageSuffix
});

async function auditOrphanPageFiles(pageIndex = null) {
  return auditOrphanPageFilesFromIndex(pageIndex || await readPageIndex());
}

function normalizeBacklinks(page) {
  if (!Array.isArray(page.backlinks)) page.backlinks = [];
  return page;
}

function normalizePageShape(page) {
  page = normalizePageRecord(page);
  if (!Array.isArray(page.objects)) page.objects = [];
  if (!Array.isArray(page.maintenanceResources)) page.maintenanceResources = [];
  page.externalLinks = normalizeExternalLinks(page.externalLinks);
  if (!Array.isArray(page.blocks)) page.blocks = [];
  page.blocks = page.blocks.map((block) => ({
    ...block,
    info: typeof block?.info === 'string' ? block.info : ''
  }));
  if (!Array.isArray(page.highlightGroups)) page.highlightGroups = [];
  page.highlightGroups = page.highlightGroups.map((group) => ({
    ...group,
    info: typeof group?.info === 'string' ? group.info : ''
  }));
  normalizeBacklinks(page);
  const rawIgnoredDescriptors = page.ignoredDescriptors;
  page.ignoredDescriptors = normalizeIgnoredDescriptors(rawIgnoredDescriptors);
  page.ignoredManualEntryIds = normalizeIgnoredManualEntryIds(
    page.ignoredManualEntryIds || page.ignoredManualDescriptorIds,
    rawIgnoredDescriptors
  );
  delete page.ignoredManualDescriptorIds;
  return page;
}

function rejectUnsupportedPageForApi(res, page) {
  if (!pageTypeDefinition(page?.type)) {
    res.status(415).json({
      error: 'This Page uses an unsupported Page Type.',
      type: typeof page?.type === 'string' ? page.type : null
    });
    return true;
  }
  const validation = validatePageRecord(page);
  if (!validation.ok) {
    res.status(422).json({
      error: validation.error || 'This Page has invalid type-owned content.',
      type: page.type,
      ...(Array.isArray(validation.errors) && validation.errors.length
        ? { errors: cloneJson(validation.errors) }
        : {})
    });
    return true;
  }
  return false;
}

function normalizePageIndexShape(pageIndex) {
  if (!pageIndex || typeof pageIndex !== 'object' || Array.isArray(pageIndex)) {
    return { pages: [] };
  }
  if (!Array.isArray(pageIndex.pages)) pageIndex.pages = [];
  pageIndex.pages = pageIndex.pages.map((entry) => normalizePageIndexEntry({ ...entry }));
  return pageIndex;
}

function normalizeVaultPreferences(value) {
  return {
    ...pageTypesModel.normalizeSettings(value),
    lastMarkdownMode: normalizeMarkdownMode(value?.lastMarkdownMode),
    cneTextMode: normalizeHnTextMode(value?.cneTextMode),
    preserveSingleLineBreaks: normalizePreserveSingleLineBreaks(
      value?.preserveSingleLineBreaks
    )
  };
}

async function readVaultPreferences() {
  const metadata = await readJson(VAULT_METADATA_PATH);
  return normalizeVaultPreferences(metadata);
}

async function updateVaultPreferences(changes) {
  const metadata = await readJson(VAULT_METADATA_PATH);
  const settings = normalizeVaultPreferences(metadata);
  if (Object.hasOwn(changes, 'defaultPageType')) {
    const validation = validateVaultDefaultPageType(changes.defaultPageType);
    if (!validation.ok) return validation;
    settings.defaultPageType = validation.type;
  }
  if (Object.hasOwn(changes, 'lastMarkdownMode')) {
    const validation = validateMarkdownMode(changes.lastMarkdownMode);
    if (!validation.ok) return validation;
    settings.lastMarkdownMode = validation.mode;
  }
  if (Object.hasOwn(changes, 'cneTextMode')) {
    const validation = validateHnTextMode(changes.cneTextMode);
    if (!validation.ok) return validation;
    settings.cneTextMode = validation.mode;
  }
  if (Object.hasOwn(changes, 'preserveSingleLineBreaks')) {
    const validation = validatePreserveSingleLineBreaks(changes.preserveSingleLineBreaks);
    if (!validation.ok) return validation;
    settings.preserveSingleLineBreaks = validation.preserveSingleLineBreaks;
  }
  const now = new Date().toISOString();
  const nextMetadata = {
    ...metadata,
    ...settings,
    updatedAt: now
  };
  await writeJsonAtomic(VAULT_METADATA_PATH, nextMetadata);
  return { ok: true, settings };
}

async function readVocabularyLibrary() {
  const vocabularyPath = path.join(DATA_DIR, 'vocabulary.json');
  try {
    return normalizeVocabularyLibrary(await readJson(vocabularyPath));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return normalizeVocabularyLibrary(samples['vocabulary.json']);
  }
}

async function writeVocabularyLibrary(library) {
  await writeJson(path.join(DATA_DIR, 'vocabulary.json'), normalizeVocabularyLibrary(library));
}

async function syncDescriptorDisplaysForVocabulary(vocabularyLibrary, previousVocabularyLibrary = null) {
  const descriptorLibrary = await readDescriptorLibrary();
  const vocabularyById = new Map((vocabularyLibrary.entries || [])
    .map((entry) => [entry.id, entry]));
  const previousVocabularyById = new Map((previousVocabularyLibrary?.entries || [])
    .map((entry) => [entry.id, entry]));
  let changedCount = 0;
  const now = new Date().toISOString();

  for (const descriptor of descriptorLibrary.entries || []) {
    let vocabularyEntry = descriptor.vocabularyEntryId
      ? vocabularyById.get(descriptor.vocabularyEntryId)
      : null;
    if (!vocabularyEntry) {
      vocabularyEntry = (vocabularyLibrary.entries || []).find((entry) => (
        previousVocabularyById.get(entry.id)?.display === descriptor.display
      ));
    }
    if (!vocabularyEntry || descriptor.display === vocabularyEntry.display) continue;
    descriptor.display = vocabularyEntry.display;
    descriptor.vocabularyEntryId = vocabularyEntry.id;
    descriptor.updatedAt = now;
    changedCount += 1;
  }

  if (changedCount) await writeDescriptorLibrary(descriptorLibrary);
  return changedCount;
}

function descriptorGroupEntryIds(groups, { uniqueAcrossClasses = false } = {}) {
  const result = [];
  const globalSeen = new Set();
  if (!groups || typeof groups !== 'object' || Array.isArray(groups)) return result;
  for (const items of Object.values(groups)) {
    if (!Array.isArray(items)) continue;
    const classSeen = new Set();
    for (const item of items) {
      const entryId = typeof item?.entryId === 'string'
        ? item.entryId
        : typeof item === 'string' ? item : null;
      if (!entryId || classSeen.has(entryId) || (uniqueAcrossClasses && globalSeen.has(entryId))) {
        continue;
      }
      classSeen.add(entryId);
      globalSeen.add(entryId);
      result.push(entryId);
    }
  }
  return result;
}

async function removeDescriptorIdsFromAllPages(deletedDescriptorIds, descriptorLibrary, updatedAt) {
  const pageIndex = await readPageIndex();
  const pageRecords = await loadCanonicalDescriptorPageRecords();
  let pageRefCount = 0;
  const affectedPageIds = new Set();

  for (const [pageId, record] of pageRecords) {
    const page = record.page;
    pageRefCount += descriptorGroupEntryIds(page.descriptors)
      .filter((entryId) => deletedDescriptorIds.has(entryId)).length;
    const activeChanged = removeDescriptorIdsFromPageDescriptors(
      page.descriptors,
      deletedDescriptorIds
    );
    const ignoredChanged = removeDescriptorIdsFromIgnored(
      page.ignoredDescriptors,
      deletedDescriptorIds
    );
    const ignoredManualChanged = removeDescriptorIdsFromPageDescriptors(
      page.ignoredManualEntryIds,
      deletedDescriptorIds
    );
    if (!activeChanged && !ignoredChanged && !ignoredManualChanged) continue;
    page.ignoredManualEntryIds = normalizeIgnoredManualEntryIds(
      page.ignoredManualEntryIds,
      page.ignoredDescriptors,
      descriptorLibrary
    );
    page.updatedAt = updatedAt;
    await writeJson(record.filePath, page);
    affectedPageIds.add(pageId);
  }

  return {
    pageRefCount,
    affectedPageCount: affectedPageIds.size,
    affectedPageIds: [...affectedPageIds],
    pageIndex
  };
}

async function remapDescriptorIdsAcrossPages(descriptorIdRemap, descriptorLibrary, updatedAt) {
  if (!descriptorIdRemap.size) {
    return { pageRefCount: 0, affectedPageCount: 0, affectedPageIds: [] };
  }

  const pageRecords = await loadCanonicalDescriptorPageRecords();
  const sourceDescriptorIds = new Set(descriptorIdRemap.keys());
  const affectedPageIds = new Set();
  let pageRefCount = 0;

  for (const [pageId, record] of pageRecords) {
    const page = record.page;
    let changed = false;
    if (page?.descriptors) {
      const beforeIds = descriptorGroupEntryIds(page.descriptors, { uniqueAcrossClasses: true });
      if (remapDescriptorIdsInGroups(page.descriptors, descriptorIdRemap)) {
        pageRefCount += beforeIds.filter((entryId) => sourceDescriptorIds.has(entryId)).length;
        page.updatedAt = updatedAt;
        changed = true;
      }
    }
    if (page?.ignoredDescriptors
      && remapDescriptorIdsInGroups(page.ignoredDescriptors, descriptorIdRemap)) {
      changed = true;
    }
    if (page?.ignoredManualEntryIds
      && remapDescriptorIdsInGroups(page.ignoredManualEntryIds, descriptorIdRemap)) {
      changed = true;
    }
    if (page) {
      page.ignoredManualEntryIds = normalizeIgnoredManualEntryIds(
        page.ignoredManualEntryIds,
        page.ignoredDescriptors,
        descriptorLibrary
      );
    }
    if (page && changed) {
      page.updatedAt = updatedAt;
      await writeJson(record.filePath, page);
    }

    if (changed) {
      affectedPageIds.add(pageId);
    }
  }

  return {
    pageRefCount,
    affectedPageCount: affectedPageIds.size,
    affectedPageIds: [...affectedPageIds]
  };
}

async function readDescriptorLibrary() {
  const descriptorsPath = path.join(DATA_DIR, 'descriptors.json');
  try {
    const raw = await readJson(descriptorsPath);
    return normalizeDescriptorLibrary(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return normalizeDescriptorLibrary(samples['descriptors.json']);
  }
}

async function writeDescriptorLibrary(library) {
  await writeJson(path.join(DATA_DIR, 'descriptors.json'), normalizeDescriptorLibrary(library));
}

async function readDescriptorGroups() {
  let raw;
  try {
    raw = await readJson(DESCRIPTOR_GROUPS_PATH);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    raw = samples['descriptorGroups.json'];
  }
  return normalizeDescriptorGroups(raw);
}

async function writeDescriptorGroups(config) {
  const result = validateDescriptorGroups(config);
  if (!result.valid) {
    const error = new Error(result.errors.join(' '));
    error.status = 400;
    throw error;
  }
  await writeJson(DESCRIPTOR_GROUPS_PATH, result.config);
  return result.config;
}

async function remapDescriptorGroupMembership(remap) {
  const current = await readDescriptorGroups();
  const result = remapMemberships(current, remap);
  if (result.changed) await writeDescriptorGroups(result.config);
  return result.changed;
}

async function removeDescriptorGroupMembership(entryIds) {
  const current = await readDescriptorGroups();
  const result = removeMemberships(current, entryIds);
  if (result.changed) await writeDescriptorGroups(result.config);
  return result.changed;
}

function repairImportedOriginalNames(page) {
  let changed = false;
  const repairItem = (item) => {
    if (!item || typeof item.originalName !== 'string') return;
    const normalized = normalizeImportedFilename(item.originalName);
    if (normalized !== item.originalName) {
      item.originalName = normalized;
      changed = true;
    }
  };

  for (const object of page.objects || []) repairItem(object);
  for (const resource of page.maintenanceResources || []) repairItem(resource);
  return changed;
}

async function readLinkTypes() {
  const linkTypesPath = path.join(DATA_DIR, 'linkTypes.json');
  try {
    const config = await readJson(linkTypesPath);
    if (!Array.isArray(config.linkTypes)) throw new Error('Invalid link type config.');
    return config;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return cloneJson(samples['linkTypes.json']);
  }
}

async function readPageIndex() {
  return normalizePageIndexShape(await readJson(path.join(DATA_DIR, 'pageIndex.json')));
}

async function writePageIndex(pageIndex) {
  await writeJson(path.join(DATA_DIR, 'pageIndex.json'), normalizePageIndexShape(pageIndex));
}

async function loadCanonicalDescriptorPageRecords() {
  const records = new Map();
  const pageFiles = await fs.readdir(PAGES_DIR, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of pageFiles.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(PAGES_DIR, entry.name);
    const page = await readJsonIfExists(filePath);
    if (!page || typeof page.id !== 'string' || !page.id) {
      throw new Error(`Canonical Page JSON ${entry.name} has no valid Page id.`);
    }
    if (records.has(page.id)) {
      throw new Error(`Duplicate canonical Page JSON id ${page.id}.`);
    }
    records.set(page.id, {
      filePath,
      relativePath: relativeDataPath(filePath),
      page: normalizePageShape(page)
    });
  }
  return records;
}

const executeDescriptorMetadataCommit = createDescriptorMetadataCommit({
  model: descriptorModel,
  getOrCreateVocabularyEntry,
  writePage: (filePath, page) => writeJsonAtomic(filePath, page),
  writePageIndex: (pageIndex) => writeJsonAtomic(
    path.join(DATA_DIR, 'pageIndex.json'),
    normalizePageIndexShape(pageIndex)
  ),
  writeDescriptorSyncIndex: (index) => saveDescriptorSyncIndex(DESCRIPTOR_SYNC_INDEX_PATH, index),
  writeDescriptorLibrary: (library) => writeJsonAtomic(
    path.join(DATA_DIR, 'descriptors.json'),
    normalizeDescriptorLibrary(library)
  ),
  writeVocabularyLibrary: (library) => writeJsonAtomic(
    path.join(DATA_DIR, 'vocabulary.json'),
    normalizeVocabularyLibrary(library)
  ),
  withTransaction: withJsonWriteTransaction
});

async function commitCanonicalDescriptorMetadata(startPageIds = [], options = {}) {
  const pageIndex = options.workingPageIndex || await readPageIndex();
  const [
    descriptorLibrary,
    vocabularyLibrary,
    descriptorSyncRules,
    linkTypes,
    previousSyncIndex,
    descriptorGroups
  ] = await settledValues([
    readDescriptorLibrary(),
    readVocabularyLibrary(),
    loadDescriptorSyncRules(),
    readLinkTypes(),
    readJsonIfExists(DESCRIPTOR_SYNC_INDEX_PATH),
    readDescriptorGroups()
  ]);
  const pageRecords = await loadCanonicalDescriptorPageRecords();
  return executeDescriptorMetadataCommit({
    pageRecords,
    pageIndex,
    previousSyncIndex,
    descriptorLibrary,
    vocabularyLibrary,
    descriptorGroups,
    descriptorSyncRules,
    linkTypes,
    directChangedPageIds: options.directChangedPageIds || [],
    changedDomains: options.changedDomains || [],
    includeVocabulary: options.includeVocabulary === true,
    includeDescriptorGroups: options.includeDescriptorGroups === true,
    materializeAutomatic: options.materializeAutomatic !== false
  });
}

async function settledValues(promises) {
  const results = await Promise.allSettled(promises);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
  return results.map((result) => result.value);
}

async function descriptorSyncIndexContext() {
  const [pageIndex, linkTypes, descriptorLibrary] = await settledValues([
    readPageIndex(), readLinkTypes(), readDescriptorLibrary()
  ]);
  return {
    pageIndex,
    linkTypes,
    classIds: descriptorClasses(descriptorLibrary).map((item) => item.id)
  };
}

async function readNavigation() {
  // navigation.json is a ready-to-render materialized projection. The queue
  // barrier prevents observing a half-finished mutation, but this read is
  // otherwise deliberately pure: no Category/Page scan and no repair write.
  return readJson(NAVIGATION_PATH);
}

async function readProjectFacade() {
  const [metadata, appearance, workspaceState] = await Promise.all([
    readJson(VAULT_METADATA_PATH),
    readJsonIfExists(APPEARANCE_PATH),
    readVaultWorkspaceState(VAULT_ROOT)
  ]);
  return {
    projectId: metadata.vaultId || metadata.projectId,
    projectName: metadata.displayName || metadata.projectName,
    version: metadata.sourceVersion || '0.4.2',
    lastOpenedPageId: workspaceState.lastOpenedPageId,
    appearance: normalizeAppearanceSettings(appearance || metadata.appearance),
    ...normalizeVaultPreferences(metadata)
  };
}

async function writeProjectFacade(project) {
  const metadata = await readJson(VAULT_METADATA_PATH);
  const now = new Date().toISOString();
  const nextMetadata = {
    ...metadata,
    vaultId: metadata.vaultId || metadata.projectId || 'vault_default',
    displayName: metadata.displayName || metadata.projectName || 'Default Vault',
    schemaVersion: metadata.schemaVersion || 1,
    updatedAt: now
  };
  const writes = await Promise.allSettled([
    writeJsonAtomic(VAULT_METADATA_PATH, nextMetadata),
    writeJsonAtomic(APPEARANCE_PATH, normalizeAppearanceSettings(project?.appearance)),
    updateVaultWorkspaceState(VAULT_ROOT, (workspaceState) => ({
      ...workspaceState,
      lastOpenedPageId: typeof project?.lastOpenedPageId === 'string'
        ? project.lastOpenedPageId
        : null
    }))
  ]);
  const failedWrite = writes.find((result) => result.status === 'rejected');
  if (failedWrite) throw failedWrite.reason;
  return readProjectFacade();
}

async function updateLastOpenedPageId(lastOpenedPageId) {
  await updateVaultWorkspaceState(VAULT_ROOT, (workspaceState) => ({
    ...workspaceState,
    lastOpenedPageId
  }));
  return readProjectFacade();
}

async function writeNavigation(navigation, workingPageIndex = null) {
  const pageIndex = workingPageIndex || await readPageIndex();
  const normalized = normalizeNavigation(navigation, pageIndex);
  await writeJson(NAVIGATION_PATH, normalized);
  return normalized;
}

function rebuildNavigationProjection(navigation, categoryConfig, pageIndex) {
  // Repair derived membership before structural normalization. Normalizing a
  // drifted projection first can prune a canonically root-eligible Page from
  // its stored position and then append it at the end during rebuild.
  const projection = NavigationProjection.rebuild({
    navigation: cloneJson(navigation),
    categoryConfig,
    pageIndex
  });
  const normalizedNavigation = normalizeNavigation(projection.navigation, pageIndex);
  return {
    ...projection,
    navigation: normalizedNavigation,
    changed: JSON.stringify(navigation) !== JSON.stringify(normalizedNavigation)
  };
}

async function persistNavigationProjection(result) {
  if (result.changed) await writeJson(NAVIGATION_PATH, result.navigation);
  return result.navigation;
}

async function persistBindingMutation(result, pageIndex) {
  if (result.error) return result;
  return {
    ...result,
    navigation: await writeNavigation(result.navigation, pageIndex)
  };
}

function touchPageIndexEntries(pageIndex, pageIds, updatedAt) {
  for (const entry of pageIndex.pages || []) {
    if (pageIds.has(entry.id)) entry.updatedAt = updatedAt;
  }
}

async function ensureSampleData() {
  const passiveOptionalFiles = new Set([
    'descriptorSyncIndex.json',
    'descriptorGroups.json',
    'descriptorSyncRules.json'
  ]);
  const existingMetadataOwners = await Promise.all([
    'pageIndex.json',
    'descriptors.json'
  ].map(async (relativePath) => {
    try {
      await fs.access(path.join(DATA_DIR, relativePath));
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }));
  const isExistingVault = existingMetadataOwners.some(Boolean);
  for (const [relativePath, value] of Object.entries(samples)) {
    if (isExistingVault && passiveOptionalFiles.has(relativePath)) continue;
    const filePath = path.join(DATA_DIR, relativePath);
    try {
      await fs.access(filePath);
    } catch {
      await writeJson(filePath, value);
    }
  }
}

async function migrateLegacyDescriptorMetadataRevision() {
  const [pageIndex, descriptorLibrary, syncIndex] = await settledValues([
    readJsonIfExists(path.join(DATA_DIR, 'pageIndex.json')),
    readJsonIfExists(path.join(DATA_DIR, 'descriptors.json')),
    readJsonIfExists(DESCRIPTOR_SYNC_INDEX_PATH)
  ]);
  const isLegacyUnrevisionedCohort = pageIndex
    && descriptorLibrary
    && syncIndex
    && Array.isArray(pageIndex.pages)
    && Array.isArray(descriptorLibrary.classes)
    && syncIndex.schemaVersion === 1
    && syncIndex.pages
    && typeof syncIndex.pages === 'object'
    && !Array.isArray(syncIndex.pages)
    && !Object.hasOwn(pageIndex, 'metadataRevision')
    && !Object.hasOwn(descriptorLibrary, 'metadataRevision')
    && !Object.hasOwn(syncIndex, 'metadataRevision');
  if (!isLegacyUnrevisionedCohort) return false;
  await commitCanonicalDescriptorMetadata([], {
    changedDomains: ['descriptorMetadataSchemaMigration']
  });
  return true;
}

const INCOMPATIBLE_STORED_TEXT_FRAME_FIELDS = Object.freeze([
  'leftWorld',
  'rightWorld',
  'leftWorldX',
  'rightWorldX',
  'center',
  'centerX',
  'x',
  'width'
]);

function canonicalStoredStructuredTextFrame(page, pageId) {
  const stored = page?.textFrame;
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const incompatibleFields = INCOMPATIBLE_STORED_TEXT_FRAME_FIELDS
      .filter((field) => Object.hasOwn(stored, field));
    if (incompatibleFields.length) {
      const error = new Error(
        `Page ${pageId} has an irreconcilable structured text frame form: `
        + `${JSON.stringify(stored)}.`
      );
      error.code = 'IRRECONCILABLE_STRUCTURED_TEXT_FRAME';
      throw error;
    }
  }
  return pageTypesModel.normalizeTextFrame(stored);
}

async function planStructuredTextFrameOwnershipMigration() {
  const rawPageIndex = await readJson(path.join(DATA_DIR, 'pageIndex.json'));
  if (!rawPageIndex || typeof rawPageIndex !== 'object' || Array.isArray(rawPageIndex)
    || !Array.isArray(rawPageIndex.pages)) {
    throw new Error('Structured text frame migration requires a valid Page index.');
  }
  const plannedWrites = [];
  const framesByPageId = new Map();
  const frameSourcesByPageId = new Map();
  const seenPaths = new Set();
  for (const entry of rawPageIndex.pages) {
    const filePath = safePageFilePath(entry);
    if (!filePath || seenPaths.has(filePath)) continue;
    seenPaths.add(filePath);
    const rawPage = await readJsonIfExists(filePath);
    if (!rawPage || typeof rawPage !== 'object' || Array.isArray(rawPage)) continue;
    const pageType = Object.hasOwn(rawPage, 'type')
      ? normalizePageType(rawPage.type)
      : PAGE_TYPES.CANVAS;
    const nextPage = cloneJson(rawPage);
    if (pageType === PAGE_TYPES.MARKDOWN || pageType === PAGE_TYPES.HN_TEXT) {
      const pageId = entry?.id || rawPage.id;
      nextPage.textFrame = canonicalStoredStructuredTextFrame(rawPage, pageId);
      if (typeof pageId === 'string' && pageId) {
        const previousFrame = framesByPageId.get(pageId);
        if (previousFrame && (previousFrame.centerWorldX !== nextPage.textFrame.centerWorldX
          || previousFrame.preferredWidth !== nextPage.textFrame.preferredWidth)) {
          const error = new Error(
            `Page ${pageId} has irreconcilable structured text frame positions in `
            + `${frameSourcesByPageId.get(pageId)} (${JSON.stringify(previousFrame)}) and `
            + `${filePath} (${JSON.stringify(nextPage.textFrame)}).`
          );
          error.code = 'IRRECONCILABLE_STRUCTURED_TEXT_FRAME';
          throw error;
        }
        framesByPageId.set(pageId, nextPage.textFrame);
        frameSourcesByPageId.set(pageId, filePath);
      }
    } else if (pageType === PAGE_TYPES.CANVAS) {
      delete nextPage.textFrame;
    } else {
      continue;
    }
    if (JSON.stringify(nextPage) !== JSON.stringify(rawPage)) {
      plannedWrites.push({ filePath, nextPage });
    }
  }
  return { plannedWrites, framesByPageId };
}

async function migrateStructuredTextFrameOwnership() {
  // Preflight every indexed Page before the first write. An unfamiliar
  // canonical-looking frame form aborts the whole transaction rather than
  // inventing precedence between geometry owners.
  const { plannedWrites, framesByPageId } = await planStructuredTextFrameOwnershipMigration();
  await migrateVaultWorkspaceStateStructuredTextFrames(VAULT_ROOT, { framesByPageId });
  for (const { filePath, nextPage } of plannedWrites) {
    await writeJsonAtomic(filePath, nextPage);
  }
}

async function migrateLastOpenedPageOwnership() {
  const pageIndex = await readPageIndex();
  const validPageIds = new Set();
  for (const page of pageIndex.pages) {
    if (typeof page.path !== 'string') continue;
    const filePath = path.resolve(DATA_DIR, page.path);
    if (!filePath.startsWith(`${PAGES_DIR}${path.sep}`)) continue;
    try {
      await fs.access(filePath);
      validPageIds.add(page.id);
    } catch {
      // Metadata membership repair is explicit; startup only supplies the
      // valid-id set to the independent one-time workspace-state migration.
    }
  }
  await migrateVaultWorkspaceStateLastOpenedPage(VAULT_ROOT, validPageIds);
}

async function migrateNavigationProjection() {
  const navigation = await readJson(NAVIGATION_PATH);
  if (!NavigationProjection.needsMigration(navigation)) return navigation;
  const [categoryConfig, pageIndex] = await Promise.all([
    readCategoryConfiguration(),
    readPageIndex()
  ]);
  const rebuilt = rebuildNavigationProjection(navigation, categoryConfig, pageIndex).navigation;
  if (JSON.stringify(navigation) !== JSON.stringify(rebuilt)) {
    await writeJson(NAVIGATION_PATH, rebuilt);
  }
  return rebuilt;
}

const INDEX_SYNC_FIELDS = [
  'type',
  'title',
  'code',
  'categories',
  'categoryIds',
  'descriptors',
  'descriptorIds',
  'thumbnail',
  'createdAt',
  'updatedAt'
];

async function updatePageIndex(pageId, changes) {
  const pageIndex = await readPageIndex();
  const entry = pageIndex.pages.find((page) => page.id === pageId);

  if (!entry) throw new Error(`Page ${pageId} is missing from pageIndex.json.`);

  for (const field of INDEX_SYNC_FIELDS) {
    if (Object.hasOwn(changes, field)) entry[field] = changes[field];
  }

  await writePageIndex(pageIndex);
}

function applyPageIndexChanges(pageIndex, pageId, changes) {
  const entry = (pageIndex.pages || []).find((page) => page.id === pageId);
  if (!entry) throw new Error(`Page ${pageId} is missing from pageIndex.json.`);
  for (const field of INDEX_SYNC_FIELDS) {
    if (Object.hasOwn(changes, field)) entry[field] = changes[field];
  }
  return entry;
}

async function repairBacklinks() {
  const pageIndex = await readPageIndex();
  const linkTypes = await readLinkTypes();
  const pageRecords = [];
  const pagesById = new Map();

  for (const entry of pageIndex.pages || []) {
    const filePath = safePageFilePath(entry);
    if (!filePath) continue;

    try {
      const page = await readJson(filePath);
      const hadBacklinksArray = Array.isArray(page.backlinks);
      normalizeBacklinks(page);
      pageRecords.push({ entry, filePath, page, hadBacklinksArray });
      pagesById.set(page.id, page);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const previousCreatedAt = new Map();
  for (const { page } of pageRecords) {
    for (const backlink of page.backlinks || []) {
      if (validBacklink(backlink) && backlink.createdAt) {
        previousCreatedAt.set(backlinkKey(backlink), backlink.createdAt);
      }
    }
  }

  const now = new Date().toISOString();
  const expectedByTarget = new Map(pageRecords.map(({ page }) => [page.id, []]));

  for (const { page } of pageRecords) {
    for (const linkRef of pageLinkRefs(page)) {
      if (!pagesById.has(linkRef.targetPageId)) continue;

      const key = backlinkKey(linkRef);
      expectedByTarget.get(linkRef.targetPageId).push(backlinkFromLink(
        linkRef,
        previousCreatedAt.get(key) || now,
        linkTypes
      ));
    }
  }

  for (const { filePath, page, hadBacklinksArray } of pageRecords) {
    const previous = JSON.stringify(page.backlinks || []);
    page.backlinks = dedupeBacklinks(expectedByTarget.get(page.id) || []);

    if (!hadBacklinksArray || JSON.stringify(page.backlinks) !== previous) {
      await writeJson(filePath, page);
    }
  }
}

async function syncBacklinksForPageLinks(previousPage, nextPage, updatedAt = new Date().toISOString()) {
  const linkTypes = await readLinkTypes();
  const previousRefs = new Map(pageLinkRefs(previousPage).map((linkRef) => [backlinkKey(linkRef), linkRef]));
  const nextRefs = new Map(pageLinkRefs(nextPage).map((linkRef) => [backlinkKey(linkRef), linkRef]));
  const targetIds = new Set([
    ...[...previousRefs.values()].map((linkRef) => linkRef.targetPageId),
    ...[...nextRefs.values()].map((linkRef) => linkRef.targetPageId)
  ]);
  if (!targetIds.size) return;

  const pageIndex = await readPageIndex();
  const entriesById = new Map((pageIndex.pages || []).map((entry) => [entry.id, entry]));
  const touchedPageIds = new Set();

  for (const targetPageId of targetIds) {
    const entry = entriesById.get(targetPageId);
    const filePath = safePageFilePath(entry);
    if (!filePath) continue;

    let targetPage;
    try {
      targetPage = normalizeBacklinks(await readJson(filePath));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }

    const before = JSON.stringify(targetPage.backlinks || []);
    const nextTargetRefs = [...nextRefs.values()]
      .filter((linkRef) => linkRef.targetPageId === targetPageId);
    const nextTargetKeys = new Set(nextTargetRefs.map(backlinkKey));
    const previousTargetKeys = new Set([...previousRefs.values()]
      .filter((linkRef) => linkRef.targetPageId === targetPageId)
      .map(backlinkKey));

    targetPage.backlinks = dedupeBacklinks(targetPage.backlinks)
      .filter((backlink) => (
        !previousTargetKeys.has(backlinkKey(backlink))
        || nextTargetKeys.has(backlinkKey(backlink))
      ));

    const existingCreatedAt = new Map(targetPage.backlinks
      .map((backlink) => [backlinkKey(backlink), backlink.createdAt]));

    for (const linkRef of nextTargetRefs) {
      const key = backlinkKey(linkRef);
      const backlink = backlinkFromLink(linkRef, existingCreatedAt.get(key) || updatedAt, linkTypes);
      const index = targetPage.backlinks.findIndex((item) => backlinkKey(item) === key);
      if (index >= 0) targetPage.backlinks[index] = backlink;
      else targetPage.backlinks.push(backlink);
    }

    targetPage.backlinks = dedupeBacklinks(targetPage.backlinks);
    if (JSON.stringify(targetPage.backlinks) !== before) {
      targetPage.updatedAt = updatedAt;
      await writeJson(filePath, targetPage);
      touchedPageIds.add(targetPage.id);
    }
  }

  if (touchedPageIds.size) {
    touchPageIndexEntries(pageIndex, touchedPageIds, updatedAt);
    await writePageIndex(pageIndex);
  }
}

async function loadDescriptorSyncRules() {
  const filePath = path.join(DATA_DIR, 'descriptorSyncRules.json');
  let config;
  try {
    config = await readJson(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    config = cloneJson(samples['descriptorSyncRules.json']);
  }

  const descriptorLibrary = await readDescriptorLibrary();
  const linkTypes = await readLinkTypes();
  const classIds = new Set(descriptorClasses(descriptorLibrary).map((item) => item.id));
  const linkTypeIds = new Set((linkTypes.linkTypes || []).map((item) => item.id));
  const seenRuleIds = new Set();
  const rules = [];
  for (const rule of Array.isArray(config?.rules) ? config.rules : []) {
    if (!rule || typeof rule.id !== 'string' || seenRuleIds.has(rule.id)
      || !classIds.has(rule.localClassId) || !classIds.has(rule.remoteClassId)
      || !linkTypeIds.has(rule.linkTypeId)
      || !['write', 'read'].includes(rule.mode)) continue;
    seenRuleIds.add(rule.id);
    rules.push({
      id: rule.id,
      enabled: rule.enabled !== false,
      localClassId: rule.localClassId,
      mode: rule.mode,
      linkTypeId: rule.linkTypeId,
      remoteClassId: rule.remoteClassId
    });
  }
  return { rules };
}

function relatedPageIds(page) {
  return new Set([
    ...pageLinkRefs(page).map((link) => link.targetPageId),
    ...(page.backlinks || [])
      .filter(validBacklink)
      .map((backlink) => backlink.sourcePageId)
  ]);
}

async function runDescriptorSync(startPageIds = [], options = {}) {
  return commitCanonicalDescriptorMetadata(startPageIds, options);
}

function newEmptyPageRecord(pageId, title, now, pageType = PAGE_TYPES.CANVAS) {
  return createPageRecord({
    id: pageId,
    title,
    code: null,
    categories: [],
    descriptors: emptyPageDescriptorGroups(),
    ignoredDescriptors: emptyPageDescriptorGroups(),
    ignoredManualEntryIds: emptyPageDescriptorGroups(),
    objects: [],
    maintenanceResources: [],
    externalLinks: [],
    blocks: [],
    highlightGroups: [],
    backlinks: [],
    createdAt: now,
    updatedAt: now
  }, pageType);
}

function newPageIndexEntry(pageId, title, relativePath, now, pageType = PAGE_TYPES.CANVAS) {
  return normalizePageIndexEntry({
    id: pageId,
    type: normalizePageType(pageType),
    title,
    code: null,
    path: relativePath,
    categoryIds: [],
    descriptors: emptyPageDescriptorGroups(),
    descriptorIds: [],
    thumbnail: null,
    createdAt: now,
    updatedAt: now
  });
}

async function pagePath(pageId, requestedPath) {
  if (!/^[a-z0-9_-]+$/i.test(pageId)) return null;

  const pageIndex = await readJson(path.join(DATA_DIR, 'pageIndex.json'));
  const entry = pageIndex.pages.find((page) => page.id === pageId);
  if (!entry || (requestedPath && requestedPath !== entry.path)) return null;

  const filePath = path.resolve(DATA_DIR, entry.path);
  if (!filePath.startsWith(`${PAGES_DIR}${path.sep}`)) return null;
  return filePath;
}

function fallbackPageIdAfterDelete(deletedPageId, pageIndex, navigation) {
  const validPageIds = new Set((pageIndex.pages || []).map((page) => page.id));
  const oldItems = (navigation.items || []).filter((item) => typeof item === 'string');
  const deletedIndex = oldItems.indexOf(deletedPageId);
  const remainingItems = oldItems.filter((pageId) => pageId !== deletedPageId && validPageIds.has(pageId));

  if (!remainingItems.length) {
    const seen = new Set();
    for (const folder of flattenFolders(navigation.folders || [])) {
      for (const pageId of resolveFolderPageIds(folder, pageIndex)) {
        if (pageId === deletedPageId || seen.has(pageId) || !validPageIds.has(pageId)) continue;
        seen.add(pageId);
        return pageId;
      }
    }
    return null;
  }
  if (deletedIndex < 0) return remainingItems[0];

  for (let index = deletedIndex + 1; index < oldItems.length; index += 1) {
    if (remainingItems.includes(oldItems[index])) return oldItems[index];
  }

  for (let index = deletedIndex - 1; index >= 0; index -= 1) {
    if (remainingItems.includes(oldItems[index])) return oldItems[index];
  }

  return remainingItems[0];
}

function navigationReferencesPage(navigation, pageId) {
  if ((navigation.items || []).includes(pageId)) return true;
  if (flattenFolders(navigation.folders || []).some((folder) => (
    (folder.source?.pageIds || []).includes(pageId)
    || (folder.projectedPageIds || []).includes(pageId)
  ))) return true;
  if (Object.hasOwn(navigation.dynamicProjection?.pages || {}, pageId)) return true;
  return (navigation.bindings || []).some((binding) => (
    binding?.leaderPageId === pageId
    || (binding?.followerPageIds || []).includes(pageId)
  ));
}

async function cleanupPagesAfterDelete(deletedPage, pageIndex, updatedAt) {
  const entriesById = new Map((pageIndex.pages || []).map((entry) => [entry.id, entry]));
  const sourceIds = new Set((deletedPage.backlinks || [])
    .filter(validBacklink)
    .map((backlink) => backlink.sourcePageId));
  const outgoingTargetIds = new Set(pageLinkRefs(deletedPage).map((linkRef) => linkRef.targetPageId));
  const pageIdsToOpen = new Set([
    ...sourceIds,
    ...outgoingTargetIds
  ]);
  const touchedPageIds = new Set();
  let fallbackScanNeeded = false;

  for (const pageId of pageIdsToOpen) {
    if (pageId === deletedPage.id) continue;

    const entry = entriesById.get(pageId);
    const filePath = safePageFilePath(entry);
    if (!filePath) {
      fallbackScanNeeded = true;
      continue;
    }

    let page;
    try {
      page = normalizeBacklinks(await readJson(filePath));
    } catch (error) {
      if (error.code === 'ENOENT') {
        fallbackScanNeeded = true;
        continue;
      }
      throw error;
    }

    const before = JSON.stringify(page);
    if (outgoingTargetIds.has(page.id)) removeBacklinksBySource(page, deletedPage.id);

    for (const backlink of deletedPage.backlinks || []) {
      if (backlink.sourcePageId !== page.id) continue;
      if (!removeIncomingLinkFromSource(page, backlink)) fallbackScanNeeded = true;
    }

    if (JSON.stringify(page) !== before) {
      page.updatedAt = updatedAt;
      await writeJson(filePath, page);
      touchedPageIds.add(page.id);
    }
  }

  if (fallbackScanNeeded) {
    for (const entry of pageIndex.pages || []) {
      if (entry.id === deletedPage.id || pageIdsToOpen.has(entry.id)) continue;

      const filePath = safePageFilePath(entry);
      if (!filePath) continue;

      let page;
      try {
        page = normalizeBacklinks(await readJson(filePath));
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }

      const before = JSON.stringify(page);
      removeBacklinksBySource(page, deletedPage.id);
      removeLinksToTargetPage(page, deletedPage.id);

      if (JSON.stringify(page) !== before) {
        page.updatedAt = updatedAt;
        await writeJson(filePath, page);
        touchedPageIds.add(page.id);
      }
    }
  }

  touchPageIndexEntries(pageIndex, touchedPageIds, updatedAt);
}

function validatedLinks(links) {
  if (!Array.isArray(links)) return null;

  const linkIds = new Set();
  const validated = [];
  for (const link of links) {
    const validId = typeof link.id === 'string' && /^[a-z0-9_-]+$/i.test(link.id);
    const validLegacyType = typeof link.type === 'string' && Boolean(link.type.trim());
    const validLinkTypeId = link.linkTypeId === undefined
      || (typeof link.linkTypeId === 'string' && /^[a-z0-9_-]+$/i.test(link.linkTypeId));
    const hasLinkType = validLegacyType || typeof link.linkTypeId === 'string';
    const validTarget = link.targetType === 'page'
      && typeof link.targetPageId === 'string'
      && /^[a-z0-9_-]+$/i.test(link.targetPageId);
    const validLabel = link.label === undefined || typeof link.label === 'string';

    if (!validId || linkIds.has(link.id) || !hasLinkType || !validLinkTypeId
      || !validTarget || !validLabel) {
      return null;
    }

    linkIds.add(link.id);
    const validatedLink = {
      id: link.id,
      type: validLegacyType ? link.type.trim() : link.linkTypeId.trim(),
      targetType: 'page',
      targetPageId: link.targetPageId
    };
    if (typeof link.linkTypeId === 'string') validatedLink.linkTypeId = link.linkTypeId.trim();
    if (link.label !== undefined) validatedLink.label = link.label;
    validated.push(validatedLink);
  }

  return validated;
}

function validatedBlocks(blocks, page) {
  if (!Array.isArray(blocks)) return null;

  const objectIds = new Set((page.objects || []).map((object) => object.id));
  const existingBlocks = new Map((page.blocks || []).map((block) => [block.id, block]));
  const blockIds = new Set();
  const validated = [];

  for (const block of blocks) {
    const validId = typeof block.id === 'string' && /^[a-z0-9_-]+$/i.test(block.id);
    const validObject = typeof block.objectId === 'string' && objectIds.has(block.objectId);
    const validGeometry = ['x', 'y', 'width', 'height']
      .every((field) => Number.isFinite(block[field]));
    const validRotation = block.rotation === undefined || Number.isFinite(block.rotation);
    const hasColour = Object.hasOwn(block, 'colour');
    const colour = hasColour ? normalizeHexColour(block.colour) : '';
    const links = validatedLinks(block.links);

    if (!validId || blockIds.has(block.id) || !validObject || !validGeometry
      || !validRotation || (hasColour && !colour)
      || block.width <= 0 || block.height <= 0 || !links) {
      return null;
    }

    blockIds.add(block.id);
    const existingBlock = existingBlocks.get(block.id);
    const existingRotation = existingBlock?.rotation;
    const existingColour = normalizeHexColour(existingBlock?.colour);
    const validatedBlock = {
      id: block.id,
      objectId: block.objectId,
      x: block.x,
      y: block.y,
      width: block.width,
      height: block.height,
      rotation: block.rotation === undefined
        ? (Number.isFinite(existingRotation) ? existingRotation : 0)
        : block.rotation,
      info: typeof block.info === 'string'
        ? block.info
        : (typeof existingBlock?.info === 'string' ? existingBlock.info : ''),
      links
    };
    if (colour || (!hasColour && existingColour)) {
      validatedBlock.colour = colour || existingColour;
    }
    validated.push(validatedBlock);
  }

  return validated;
}

function validatedHighlightGroups(groups, blocks = [], existingGroups = []) {
  if (!Array.isArray(groups)) return null;
  const existingBlockIds = new Set((blocks || []).map((block) => block.id));
  const existingGroupsById = new Map((existingGroups || []).map((group) => [group.id, group]));
  const groupIds = new Set();
  const validated = [];
  for (const group of groups) {
    const validId = typeof group?.id === 'string' && /^[a-z0-9_-]+$/i.test(group.id);
    const name = typeof group?.name === 'string' ? group.name.trim() : '';
    const sourceBlockIds = group?.blockIds || group?.blocks || [];
    if (!validId || groupIds.has(group.id) || !name || !Array.isArray(sourceBlockIds)) return null;
    const blockIds = [];
    const seenBlockIds = new Set();
    for (const item of sourceBlockIds) {
      const blockId = typeof item === 'string' ? item : item?.id;
      if (typeof blockId !== 'string' || !/^[a-z0-9_-]+$/i.test(blockId)) return null;
      if (!existingBlockIds.has(blockId) || seenBlockIds.has(blockId)) continue;
      seenBlockIds.add(blockId);
      blockIds.push(blockId);
    }
    groupIds.add(group.id);
    if (blockIds.length) {
      const existingGroup = existingGroupsById.get(group.id);
      validated.push({
        id: group.id,
        name,
        blockIds,
        info: typeof group.info === 'string'
          ? group.info
          : (typeof existingGroup?.info === 'string' ? existingGroup.info : '')
      });
    }
  }
  return validated;
}

function validatedObjectLayout(objects, page, { allowSetChanges = false } = {}) {
  if (!Array.isArray(objects)) return null;
  const originals = new Map((page.objects || []).map((object) => [object.id, object]));
  const seen = new Set();
  const validated = [];
  for (const edit of objects) {
    if (!edit || typeof edit.id !== 'string' || !/^[a-z0-9_-]+$/i.test(edit.id)
      || seen.has(edit.id)) return null;
    if (!['x', 'y', 'width', 'height'].every((field) => Number.isFinite(edit[field]))
      || edit.width <= 0 || edit.height <= 0) return null;
    seen.add(edit.id);
    const original = originals.get(edit.id);
    if (original) {
      validated.push({
        ...original,
        x: edit.x,
        y: edit.y,
        width: edit.width,
        height: edit.height
      });
      continue;
    }

    if (!allowSetChanges) return null;

    let location;
    try {
      location = normalizeResourceLocation(edit);
    } catch {
      return null;
    }
    if (edit.type !== 'image' || edit.displayable === false || edit.visible === false) return null;
    if (!Number.isFinite(edit.naturalWidth) || edit.naturalWidth <= 0
      || !Number.isFinite(edit.naturalHeight) || edit.naturalHeight <= 0) return null;
    const textFields = ['originalName', 'fileName', 'mimeType', 'resourceType'];
    if (textFields.some((field) => typeof edit[field] !== 'string' || !edit[field].trim())) return null;
    validated.push({
      id: edit.id,
      type: 'image',
      location,
      ...(location.type === 'vault' ? { src: location.relativePath } : {}),
      originalName: edit.originalName,
      fileName: edit.fileName,
      mimeType: edit.mimeType,
      resourceType: edit.resourceType,
      displayable: true,
      visible: true,
      x: edit.x,
      y: edit.y,
      naturalWidth: edit.naturalWidth,
      naturalHeight: edit.naturalHeight,
      width: edit.width,
      height: edit.height,
      ...(Number.isFinite(edit.size) && edit.size >= 0 ? { size: edit.size } : {}),
      ...(typeof edit.createdAt === 'string' ? { createdAt: edit.createdAt } : {})
    });
  }
  if (!allowSetChanges && seen.size !== originals.size) return null;
  return validated;
}

function collectCategoryItemIds(nodes = [], ids = new Set()) {
  for (const node of nodes || []) {
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'item' && typeof node.id === 'string') ids.add(node.id);
    if (Array.isArray(node.children)) collectCategoryItemIds(node.children, ids);
  }
  return ids;
}

async function readCategoryConfiguration() {
  return categoryNavigation.normalizeCategoryConfiguration(
    await readJson(path.join(DATA_DIR, 'categories.json'))
  );
}

function categoryNodeIds(config) {
  const ids = new Set();
  const visit = (nodes) => {
    for (const node of nodes || []) {
      if (!node || typeof node !== 'object') continue;
      if (typeof node.id === 'string') ids.add(node.id);
      if (Array.isArray(node.children)) visit(node.children);
    }
  };
  visit(config?.groups);
  return ids;
}

function uniqueCategoryNodeId(config, prefix) {
  const ids = categoryNodeIds(config);
  const base = `${prefix}_${Date.now().toString(36)}`;
  if (!ids.has(base)) return base;
  let number = 1;
  while (ids.has(`${base}_${number}`)) number += 1;
  return `${base}_${number}`;
}

function findCategoryGroup(nodes, groupId) {
  for (const node of nodes || []) {
    if (!node || typeof node !== 'object' || node.type === 'item') continue;
    if (node.id === groupId) return node;
    const nested = findCategoryGroup(node.children, groupId);
    if (nested) return nested;
  }
  return null;
}

function findCategoryItem(nodes, categoryId) {
  for (const node of nodes || []) {
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'item') {
      if (node.id === categoryId) return node;
      continue;
    }
    const nested = findCategoryItem(node.children, categoryId);
    if (nested) return nested;
  }
  return null;
}

function categoryRenameLabel(value) {
  if (typeof value !== 'string') return null;
  const label = value.trim();
  return label || null;
}

function removeCategoryNode(nodes, nodeId, requiredType) {
  for (let index = 0; index < (nodes || []).length; index += 1) {
    const node = nodes[index];
    const type = node?.type === 'item' ? 'item' : 'group';
    if (node?.id === nodeId && type === requiredType) {
      nodes.splice(index, 1);
      return node;
    }
    if (type === 'group') {
      const removed = removeCategoryNode(node.children, nodeId, requiredType);
      if (removed) return removed;
    }
  }
  return null;
}

async function writeJsonTransaction(records) {
  const written = [];
  try {
    for (const record of records) {
      await writeJsonAtomic(record.filePath, record.nextValue);
      written.push(record);
    }
  } catch (error) {
    for (const record of written.reverse()) {
      await writeJsonAtomic(record.filePath, record.previousValue).catch((rollbackError) => {
        console.error(`Failed to roll back ${record.filePath}:`, rollbackError);
      });
    }
    throw error;
  }
}

async function knownCategoryIds() {
  const config = await readCategoryConfiguration();
  const roots = Array.isArray(config.groups)
    ? config.groups
    : Array.isArray(config.categories) ? config.categories.map((category) => ({
      type: 'item',
      id: category.id,
      label: category.label
    })) : [];
  return collectCategoryItemIds(roots);
}

async function validatedCategories(categories) {
  if (!Array.isArray(categories)) return null;

  const knownIds = await knownCategoryIds();
  const selected = [];
  const seen = new Set();
  for (const categoryId of categories) {
    if (typeof categoryId !== 'string' || seen.has(categoryId) || !knownIds.has(categoryId)) {
      return null;
    }
    seen.add(categoryId);
    selected.push(categoryId);
  }

  return selected;
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(APP_ROOT, 'public')));
app.use('/api', serializePageMutation);
app.use('/assets', express.static(ASSETS_DIR));

app.get('/api/project', async (req, res, next) => {
  try {
    res.json(await readProjectFacade());
  } catch (error) {
    next(error);
  }
});

app.patch('/api/project', async (req, res, next) => {
  const { lastOpenedPageId } = req.body;
  if (typeof lastOpenedPageId !== 'string' || !/^[a-z0-9_-]+$/i.test(lastOpenedPageId)) {
    return res.status(400).json({ error: 'A valid last opened page ID is required.' });
  }

  try {
    const filePath = await pagePath(lastOpenedPageId);
    if (!filePath) return res.status(400).json({ error: 'Page is not in the page index.' });
    await fs.access(filePath);

    const project = await updateLastOpenedPageId(lastOpenedPageId);
    res.json(project);
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(400).json({ error: 'Page file does not exist.' });
    next(error);
  }
});

app.get('/api/appearance', async (req, res, next) => {
  try {
    const appearance = await readJsonIfExists(APPEARANCE_PATH);
    const metadata = appearance ? null : await readJson(VAULT_METADATA_PATH);
    res.json(normalizeAppearanceSettings(appearance || metadata?.appearance));
  } catch (error) {
    next(error);
  }
});

app.put('/api/appearance', async (req, res, next) => {
  const validation = validateAppearanceSettings(req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.error });
  try {
    await writeJsonAtomic(APPEARANCE_PATH, validation.appearance);
    res.json(validation.appearance);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/appearance/block-colour-presets/:presetId', transactionalJsonRoute(async (req, res, next) => {
  try {
    const presetId = normalizeBlockColourPresetId(req.params.presetId);
    const expectedColour = normalizeHexColour(req.body?.expectedColour);
    const colour = normalizeHexColour(req.body?.colour);
    if (!presetId || !expectedColour || !colour || typeof req.body?.globalApply !== 'boolean') {
      return res.status(400).json({
        error: 'A valid preset ID, expected colour, colour, and Global Apply choice are required.'
      });
    }

    const storedAppearance = await readJsonIfExists(APPEARANCE_PATH);
    const metadata = storedAppearance ? null : await readJson(VAULT_METADATA_PATH);
    const appearance = normalizeAppearanceSettings(storedAppearance || metadata?.appearance);
    const presets = appearance.blockAppearance.colourfulBlock.presets;
    const preset = presets.find((candidate) => candidate.id === presetId);
    if (!preset) return res.status(404).json({ error: 'Colour preset not found.' });
    if (preset.colour !== expectedColour) {
      return res.status(409).json({
        error: 'The colour preset changed before this edit could be saved.',
        currentColour: preset.colour
      });
    }
    if (presets.some((candidate) => candidate.id !== presetId && candidate.colour === colour)) {
      return res.status(409).json({ error: 'That colour already belongs to another preset.' });
    }

    const nextAppearance = cloneJson(appearance);
    nextAppearance.blockAppearance.colourfulBlock.presets
      .find((candidate) => candidate.id === presetId).colour = colour;
    const validation = validateAppearanceSettings(nextAppearance);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    let workingPageIndex = null;
    const plannedPageWrites = [];
    let changedBlockCount = 0;
    if (req.body.globalApply) {
      const pageIndexPath = path.join(DATA_DIR, 'pageIndex.json');
      const rawPageIndex = await readJson(pageIndexPath);
      if (!rawPageIndex || typeof rawPageIndex !== 'object' || Array.isArray(rawPageIndex)
        || !Array.isArray(rawPageIndex.pages)) {
        return res.status(409).json({ error: 'Global Apply requires a valid Page index.' });
      }
      workingPageIndex = normalizePageIndexShape(cloneJson(rawPageIndex));
      const seenPageIds = new Set();
      const updatedAt = new Date().toISOString();

      for (const entry of workingPageIndex.pages) {
        const pageId = typeof entry?.id === 'string' ? entry.id : '';
        const filePath = safePageFilePath(entry);
        if (!pageId || seenPageIds.has(pageId) || !filePath) {
          return res.status(409).json({
            error: 'Global Apply requires every indexed Page to have one safe canonical path.',
            pageId: pageId || null
          });
        }
        seenPageIds.add(pageId);

        let rawPage;
        try {
          rawPage = await readJson(filePath);
        } catch (error) {
          if (error.code === 'ENOENT' || error instanceof SyntaxError) {
            return res.status(409).json({
              error: 'Global Apply could not read every indexed Page.',
              pageId
            });
          }
          throw error;
        }
        if (!rawPage || typeof rawPage !== 'object' || Array.isArray(rawPage)
          || rawPage.id !== pageId || !Array.isArray(rawPage.blocks)
          || rawPage.blocks.some((block) => (
            !block || typeof block !== 'object' || Array.isArray(block)
            || (Object.hasOwn(block, 'colour') && !normalizeHexColour(block.colour))
          ))) {
          return res.status(409).json({
            error: 'Global Apply found a malformed indexed Page.',
            pageId
          });
        }

        const nextPage = cloneJson(rawPage);
        let pageBlockCount = 0;
        for (const block of nextPage.blocks) {
          if (Object.hasOwn(block, 'colour')
            && normalizeHexColour(block.colour) === expectedColour) {
            block.colour = colour;
            pageBlockCount += 1;
          }
        }
        if (!pageBlockCount || expectedColour === colour) continue;
        nextPage.updatedAt = updatedAt;
        applyPageIndexChanges(workingPageIndex, pageId, { updatedAt });
        plannedPageWrites.push({ filePath, nextPage });
        changedBlockCount += pageBlockCount;
      }
    }

    await writeJsonAtomic(APPEARANCE_PATH, validation.appearance);
    for (const planned of plannedPageWrites) {
      await writeJsonAtomic(planned.filePath, planned.nextPage);
    }
    if (plannedPageWrites.length) {
      await writeJsonAtomic(
        path.join(DATA_DIR, 'pageIndex.json'),
        normalizePageIndexShape(workingPageIndex)
      );
    }

    res.json({
      appearance: validation.appearance,
      pages: plannedPageWrites.map(({ nextPage }) => nextPage),
      pageIndex: workingPageIndex,
      changedPageIds: plannedPageWrites.map(({ nextPage }) => nextPage.id),
      changedBlockCount,
      globalApply: req.body.globalApply
    });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/vault-preferences', async (req, res, next) => {
  try {
    res.json(await readVaultPreferences());
  } catch (error) {
    next(error);
  }
});

async function saveVaultPreferencesRequest(req, res, next) {
  const changes = {};
  if (Object.hasOwn(req.body || {}, 'defaultPageType')) {
    changes.defaultPageType = req.body.defaultPageType;
  }
  if (Object.hasOwn(req.body || {}, 'lastMarkdownMode')) {
    changes.lastMarkdownMode = req.body.lastMarkdownMode;
  }
  if (Object.hasOwn(req.body || {}, 'cneTextMode')) {
    changes.cneTextMode = req.body.cneTextMode;
  }
  if (Object.hasOwn(req.body || {}, 'preserveSingleLineBreaks')) {
    changes.preserveSingleLineBreaks = req.body.preserveSingleLineBreaks;
  }
  if (!Object.keys(changes).length) {
    return res.status(400).json({ error: 'No supported Vault preference changes were provided.' });
  }
  try {
    const operation = vaultPreferenceMutationQueue
      .catch(() => {})
      .then(() => updateVaultPreferences(changes));
    vaultPreferenceMutationQueue = operation;
    const result = await operation;
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json(result.settings);
  } catch (error) {
    return next(error);
  }
}

app.put('/api/vault-preferences', saveVaultPreferencesRequest);
app.patch('/api/vault-preferences', saveVaultPreferencesRequest);

app.get('/api/page-index', async (req, res, next) => {
  try {
    res.json(await readPageIndex());
  } catch (error) {
    next(error);
  }
});

app.get('/api/navigation', async (req, res, next) => {
  try {
    res.json(await readNavigation());
  } catch (error) {
    next(error);
  }
});

app.post('/api/navigation/rebuild', transactionalJsonRoute(async (req, res, next) => {
  try {
    const [navigation, categoryConfig, pageIndex] = await Promise.all([
      readNavigation(),
      readCategoryConfiguration(),
      readPageIndex()
    ]);
    const rebuilt = rebuildNavigationProjection(
      navigation,
      categoryConfig,
      pageIndex
    ).navigation;
    await writeJson(NAVIGATION_PATH, rebuilt);
    res.json({ navigation: rebuilt });
  } catch (error) {
    next(error);
  }
}));

app.patch('/api/navigation/folders/:folderId', async (req, res, next) => {
  try {
    if (!/^[a-z0-9_-]+$/i.test(req.params.folderId)) {
      return res.status(400).json({ error: 'A valid folder ID is required.' });
    }
    if (typeof req.body.collapsed !== 'boolean') {
      return res.status(400).json({ error: 'A boolean collapsed value is required.' });
    }

    const navigation = await readNavigation();
    const location = findFolderLocation(navigation.folders, req.params.folderId);
    if (!location) return res.status(404).json({ error: 'Folder not found.' });

    location.folder.collapsed = req.body.collapsed;
    await writeNavigation(navigation);
    res.json(navigation);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/navigation/folders/:folderId/stick-on-top', async (req, res, next) => {
  if (typeof req.body.enabled !== 'boolean') {
    return res.status(400).json({ error: 'A boolean Stick on top value is required.' });
  }
  try {
    const navigation = await readNavigation();
    const location = findFolderLocation(navigation.folders, req.params.folderId);
    if (!location) return res.status(404).json({ error: 'Folder not found.' });
    if (location.folder.type !== 'manual' || location.folder.source?.kind !== 'manual') {
      return res.status(400).json({ error: 'Only manual folders can be stuck on top.' });
    }
    location.folder.stickOnTop = req.body.enabled;
    const savedNavigation = await writeNavigation(navigation);
    res.json({ navigation: savedNavigation, stickOnTop: location.folder.stickOnTop });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/navigation/pages/:pageId/stick-on-top', async (req, res, next) => {
  if (typeof req.body.enabled !== 'boolean') {
    return res.status(400).json({ error: 'A boolean Stick on top value is required.' });
  }
  try {
    const pageIndex = await readPageIndex();
    if (!(pageIndex.pages || []).some((page) => page.id === req.params.pageId)) {
      return res.status(404).json({ error: 'Page not found.' });
    }
    const navigation = await readNavigation();
    const normalEntry = (navigation.items || []).includes(req.params.pageId)
      || Boolean(findManualPageLocation(navigation.folders, req.params.pageId));
    if (!normalEntry) {
      return res.status(400).json({ error: 'Only normal navigation pages can be stuck on top.' });
    }
    setPageStickOnTop(navigation, req.params.pageId, req.body.enabled);
    const savedNavigation = await writeNavigation(navigation, pageIndex);
    res.json({
      navigation: savedNavigation,
      stickOnTop: pageStickOnTop(savedNavigation, req.params.pageId)
    });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/navigation/folders/:folderId/default-page', async (req, res, next) => {
  const pageId = req.body.pageId === null ? null : req.body.pageId;
  if (pageId !== null && typeof pageId !== 'string') {
    return res.status(400).json({ error: 'A page ID or null is required.' });
  }
  try {
    const pageIndex = await readPageIndex();
    const navigation = await readNavigation();
    const location = findFolderLocation(navigation.folders, req.params.folderId);
    if (!location) return res.status(404).json({ error: 'Folder not found.' });
    const folder = location.folder;
    if (folder.type !== 'manual' || folder.source?.kind !== 'manual') {
      return res.status(400).json({ error: 'Only manual folders can have a default page.' });
    }
    if (pageId !== null && !(folder.source.pageIds || []).includes(pageId)) {
      return res.status(400).json({ error: 'The default page must be a direct child of this folder.' });
    }
    folder.defaultPageId = pageId;
    const savedNavigation = await writeNavigation(navigation, pageIndex);
    res.json({ navigation: savedNavigation, defaultPageId: pageId });
  } catch (error) {
    next(error);
  }
});

app.post('/api/navigation/folders', async (req, res, next) => {
  try {
    const navigation = await readNavigation();
    const parentFolderId = req.body?.parentFolderId;
    if (parentFolderId != null && typeof parentFolderId !== 'string') {
      return res.status(400).json({ error: 'A valid parent folder ID is required.' });
    }
    const parentLocation = parentFolderId
      ? findFolderLocation(navigation.folders, parentFolderId)
      : null;
    const parentFolder = parentLocation?.folder || null;
    if (parentFolderId && (!parentFolder
      || parentFolder.type !== 'manual'
      || parentFolder.source?.kind !== 'manual')) {
      return res.status(400).json({ error: 'New folders can only be created inside a manual folder.' });
    }
    const folderId = await uniqueDatedFolderId(navigation);
    const label = makeUniqueFolderLabel(navigation, 'New folder');
    const folder = {
      id: folderId,
      label,
      type: 'manual',
      pinned: false,
      stickOnTop: false,
      collapsed: false,
      defaultPageId: null,
      pinnedPageIds: [],
      pageOrder: [],
      source: {
        kind: 'manual',
        pageIds: []
      },
      children: []
    };

    if (parentFolder) {
      parentFolder.children.push(folder);
      parentFolder.collapsed = false;
    } else {
      navigation.folders.push(folder);
    }
    const savedNavigation = await writeNavigation(navigation);
    res.status(201).json({ navigation: savedNavigation, folder });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/navigation/folders/:folderId/label', async (req, res, next) => {
  try {
    if (typeof req.body.label !== 'string') {
      return res.status(400).json({ error: 'A folder label is required.' });
    }

    const navigation = await readNavigation();
    const location = findFolderLocation(navigation.folders, req.params.folderId);
    if (!location) return res.status(404).json({ error: 'Folder not found.' });
    if (location.folder.type === 'system') {
      return res.status(400).json({ error: 'System folder labels cannot be edited.' });
    }

    location.folder.label = makeUniqueFolderLabel(navigation, req.body.label, location.folder.id);
    const savedNavigation = await writeNavigation(navigation);
    res.json({ navigation: savedNavigation, folder: location.folder });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/navigation/folders/:folderId', async (req, res, next) => {
  try {
    if (!/^[a-z0-9_-]+$/i.test(req.params.folderId)) {
      return res.status(400).json({ error: 'A valid folder ID is required.' });
    }

    const pageIndex = await readPageIndex();
    const navigation = await readNavigation();
    const location = findFolderLocation(navigation.folders, req.params.folderId);
    if (!location) return res.status(404).json({ error: 'Folder not found.' });
    if (location.folder.type !== 'manual' || location.folder.source?.kind !== 'manual') {
      return res.status(400).json({ error: 'Only manual folders can be deleted.' });
    }

    const deletedFolder = removeFolderById(navigation.folders, req.params.folderId);
    const normalizedNavigation = normalizeNavigation(navigation, pageIndex);
    const savedNavigation = await writeNavigation(normalizedNavigation, pageIndex);
    res.json({
      navigation: savedNavigation,
      deletedFolderId: req.params.folderId,
      releasedPageIds: [...new Set(collectFolderPageIds(deletedFolder))]
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/navigation/move', async (req, res, next) => {
  try {
    const navigation = await readNavigation();
    const pageIndex = await readPageIndex();
    const destination = req.body?.destination && typeof req.body.destination === 'object'
      ? req.body.destination
      : {};
    const moved = await persistNavigationMove(
      navigation,
      pageIndex,
      req.body?.items,
      destination,
      writeNavigation
    );
    if (moved.error) return res.status(400).json({ error: moved.error });
    return res.json({
      navigation: moved.navigation,
      movedItems: moved.items,
      changed: moved.changed
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/navigation/bindings', async (req, res, next) => {
  try {
    const navigation = await readNavigation();
    const pageIndex = await readPageIndex();
    const selectedPageIds = req.body?.selectedPageIds;
    const leaderPageId = req.body?.leaderPageId;
    const targetRole = typeof leaderPageId === 'string'
      ? bindingForPage(navigation, leaderPageId)
      : null;
    const mutation = targetRole?.role === 'leader'
      ? addFollowers(navigation, pageIndex, leaderPageId, selectedPageIds)
      : createBinding(navigation, pageIndex, selectedPageIds, leaderPageId);
    const saved = await persistBindingMutation(mutation, pageIndex);
    if (saved.error) return res.status(400).json({ error: saved.error });
    return res.json({ navigation: saved.navigation });
  } catch (error) {
    next(error);
  }
});

app.post('/api/navigation/bindings/stop', async (req, res, next) => {
  try {
    const navigation = await readNavigation();
    const pageIndex = await readPageIndex();
    const mutation = removeFollower(navigation, pageIndex, req.body?.followerPageId);
    const saved = await persistBindingMutation(mutation, pageIndex);
    if (saved.error) return res.status(400).json({ error: saved.error });
    return res.json({ navigation: saved.navigation });
  } catch (error) {
    next(error);
  }
});

app.post('/api/navigation/bindings/set-leader', async (req, res, next) => {
  try {
    const navigation = await readNavigation();
    const pageIndex = await readPageIndex();
    const mutation = setBindingLeader(navigation, pageIndex, req.body?.followerPageId);
    const saved = await persistBindingMutation(mutation, pageIndex);
    if (saved.error) return res.status(400).json({ error: saved.error });
    return res.json({ navigation: saved.navigation });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/navigation/bindings/:groupId', async (req, res, next) => {
  try {
    const navigation = await readNavigation();
    const pageIndex = await readPageIndex();
    const mutation = dissolveBinding(navigation, pageIndex, req.params.groupId);
    const saved = await persistBindingMutation(mutation, pageIndex);
    if (saved.error) return res.status(400).json({ error: saved.error });
    return res.json({ navigation: saved.navigation });
  } catch (error) {
    next(error);
  }
});

app.post('/api/navigation/folders/:folderId/move', async (req, res, next) => {
  try {
    const navigation = await readNavigation();
    const pageIndex = await readPageIndex();
    const targetLocation = findFolderLocation(navigation.folders, req.params.folderId);
    if (!targetLocation) return res.status(404).json({ error: 'Target folder not found.' });
    const targetFolder = targetLocation.folder;
    if (targetFolder.type !== 'manual' || targetFolder.source?.kind !== 'manual') {
      return res.status(400).json({ error: 'Items can only be moved into manual folders.' });
    }

    if (req.body.itemType === 'page') {
      if (typeof req.body.pageId !== 'string') return res.status(400).json({ error: 'A page ID is required.' });
      if (!(pageIndex.pages || []).some((page) => page.id === req.body.pageId)) {
        return res.status(404).json({ error: 'Page not found.' });
      }
    }

    if (req.body.itemType === 'folder') {
      if (typeof req.body.folderId !== 'string') return res.status(400).json({ error: 'A folder ID is required.' });
      if (req.body.folderId === targetFolder.id) {
        return res.status(400).json({ error: 'A folder cannot be moved into itself.' });
      }
      const draggedLocation = findFolderLocation(navigation.folders, req.body.folderId);
      if (!draggedLocation) return res.status(404).json({ error: 'Folder not found.' });
      if (draggedLocation.folder.type === 'system') {
        return res.status(400).json({ error: 'System folders cannot be moved.' });
      }
      if (folderContainsFolder(draggedLocation.folder, targetFolder.id)) {
        return res.status(400).json({ error: 'A folder cannot be moved into its descendant.' });
      }
    }

    if (!['page', 'folder'].includes(req.body.itemType)) {
      return res.status(400).json({ error: 'Unsupported move item type.' });
    }
    const id = req.body.itemType === 'page' ? req.body.pageId : req.body.folderId;
    const moved = await persistNavigationMove(
      navigation,
      pageIndex,
      [{ type: req.body.itemType, id }],
      { parentFolderId: targetFolder.id },
      writeNavigation
    );
    if (moved.error) return res.status(400).json({ error: moved.error });
    return res.json({ navigation: moved.navigation });
  } catch (error) {
    next(error);
  }
});

app.post('/api/navigation/root/move', async (req, res, next) => {
  try {
    const navigation = await readNavigation();
    const pageIndex = await readPageIndex();

    if (req.body.itemType === 'page') {
      if (typeof req.body.pageId !== 'string') return res.status(400).json({ error: 'A page ID is required.' });
      if (!(pageIndex.pages || []).some((page) => page.id === req.body.pageId)) {
        return res.status(404).json({ error: 'Page not found.' });
      }
    }

    if (req.body.itemType === 'folder') {
      if (typeof req.body.folderId !== 'string') return res.status(400).json({ error: 'A folder ID is required.' });
      const draggedLocation = findFolderLocation(navigation.folders, req.body.folderId);
      if (!draggedLocation) return res.status(404).json({ error: 'Folder not found.' });
      if (draggedLocation.folder.type === 'system') {
        return res.status(400).json({ error: 'System folders cannot be moved.' });
      }
    }

    if (!['page', 'folder'].includes(req.body.itemType)) {
      return res.status(400).json({ error: 'Unsupported move item type.' });
    }
    const id = req.body.itemType === 'page' ? req.body.pageId : req.body.folderId;
    const destination = req.body.itemType === 'page'
      ? {
        area: 'pages',
        ...(Number.isInteger(req.body.rootIndex) && req.body.rootIndex >= 0
          ? { index: req.body.rootIndex }
          : {})
      }
      : { area: 'folders' };
    const moved = await persistNavigationMove(
      navigation,
      pageIndex,
      [{ type: req.body.itemType, id }],
      destination,
      writeNavigation
    );
    if (moved.error) return res.status(400).json({ error: moved.error });
    return res.json({ navigation: moved.navigation });
  } catch (error) {
    next(error);
  }
});

app.post('/api/navigation/insert', async (req, res, next) => {
  try {
    const navigation = await readNavigation();
    const pageIndex = await readPageIndex();
    const parentFolderId = typeof req.body.parentFolderId === 'string' ? req.body.parentFolderId : null;
    const targetLocation = parentFolderId ? findFolderLocation(navigation.folders, parentFolderId) : null;
    const targetFolder = targetLocation?.folder || null;
    if (parentFolderId && (!targetFolder || targetFolder.type !== 'manual' || targetFolder.source?.kind !== 'manual')) {
      return res.status(400).json({ error: 'Items can only be inserted into root or manual folders.' });
    }

    if (req.body.itemType === 'page') {
      if (typeof req.body.pageId !== 'string') return res.status(400).json({ error: 'A page ID is required.' });
      if (!(pageIndex.pages || []).some((page) => page.id === req.body.pageId)) {
        return res.status(404).json({ error: 'Page not found.' });
      }
    }

    if (req.body.itemType === 'folder') {
      if (typeof req.body.folderId !== 'string') return res.status(400).json({ error: 'A folder ID is required.' });
      if (parentFolderId && req.body.folderId === parentFolderId) {
        return res.status(400).json({ error: 'A folder cannot be moved into itself.' });
      }
      const draggedLocation = findFolderLocation(navigation.folders, req.body.folderId);
      if (!draggedLocation) return res.status(404).json({ error: 'Folder not found.' });
      if (draggedLocation.folder.type === 'system') {
        return res.status(400).json({ error: 'System folders cannot be moved.' });
      }
      if (targetFolder && folderContainsFolder(draggedLocation.folder, targetFolder.id)) {
        return res.status(400).json({ error: 'A folder cannot be moved into its descendant.' });
      }
    }

    if (!['page', 'folder'].includes(req.body.itemType)) {
      return res.status(400).json({ error: 'Unsupported insert item type.' });
    }
    const itemType = req.body.itemType;
    const id = itemType === 'page' ? req.body.pageId : req.body.folderId;
    const hasIndex = Number.isInteger(req.body.index) && req.body.index >= 0;
    let index = hasIndex ? req.body.index : null;
    if (itemType === 'folder' && targetFolder && index !== null) {
      // The legacy insert route indexes the target folder's child-folder list.
      // The shared move model indexes the combined Page/folder target stream.
      index += (targetFolder.source.pageIds || []).length;
    }
    const destination = {
      parentFolderId,
      area: itemType === 'page' ? 'pages' : 'folders',
      ...(index !== null ? { index } : {})
    };
    const moved = await persistNavigationMove(
      navigation,
      pageIndex,
      [{ type: itemType, id }],
      destination,
      writeNavigation
    );
    if (moved.error) return res.status(400).json({ error: moved.error });
    return res.json({ navigation: moved.navigation });
  } catch (error) {
    next(error);
  }
});

app.get('/api/link-types', async (req, res, next) => {
  try {
    res.json(await readLinkTypes());
  } catch (error) {
    next(error);
  }
});

app.get('/api/categories', async (req, res, next) => {
  try {
    res.json(await readCategoryConfiguration());
  } catch (error) {
    next(error);
  }
});

app.patch('/api/categories/navigation', transactionalJsonRoute(async (req, res, next) => {
  try {
    const categoryPath = path.join(DATA_DIR, 'categories.json');
    const navigationPath = path.join(DATA_DIR, 'navigation.json');
    const [previousCategoryValue, previousNavigation] = await Promise.all([
      readJson(categoryPath),
      readJson(navigationPath)
    ]);
    const categoryConfig = categoryNavigation.normalizeCategoryConfiguration(previousCategoryValue);
    const previousNavigationSettings = cloneJson(categoryConfig.navigation);
    const validCategoryIds = new Set(
      categoryNavigation.categoryItemsInOrder(categoryConfig).map((item) => item.id)
    );
    const patch = req.body || {};
    if (Object.hasOwn(patch, 'enabledCategoryIds')) {
      if (!Array.isArray(patch.enabledCategoryIds)
        || patch.enabledCategoryIds.some((categoryId) => (
          typeof categoryId !== 'string' || !validCategoryIds.has(categoryId)
        ))) {
        return res.status(400).json({ error: 'Invalid enabled Category IDs.' });
      }
      categoryConfig.navigation.enabledCategoryIds = [...new Set(patch.enabledCategoryIds)];
    }
    for (const field of ['collapseUncategorisedPages', 'quantityStatistics']) {
      if (!Object.hasOwn(patch, field)) continue;
      if (typeof patch[field] !== 'boolean') {
        return res.status(400).json({ error: `Invalid ${field} setting.` });
      }
      categoryConfig.navigation[field] = patch[field];
    }
    const normalizedConfig = categoryNavigation.normalizeCategoryConfiguration(categoryConfig);
    const projectionInputsChanged = JSON.stringify(
      previousNavigationSettings.enabledCategoryIds
    ) !== JSON.stringify(normalizedConfig.navigation.enabledCategoryIds)
      || previousNavigationSettings.collapseUncategorisedPages
        !== normalizedConfig.navigation.collapseUncategorisedPages;
    let syncedNavigation = previousNavigation;
    const writes = [{
      filePath: categoryPath,
      previousValue: previousCategoryValue,
      nextValue: normalizedConfig
    }];
    if (projectionInputsChanged) {
      syncedNavigation = rebuildNavigationProjection(
        previousNavigation,
        normalizedConfig,
        await readPageIndex()
      ).navigation;
      writes.push({
        filePath: navigationPath,
        previousValue: previousNavigation,
        nextValue: syncedNavigation
      });
    }
    await writeJsonTransaction(writes);
    res.json({ categoryConfig: normalizedConfig, navigation: syncedNavigation });
  } catch (error) {
    next(error);
  }
}));

app.post('/api/categories/groups', transactionalJsonRoute(async (req, res, next) => {
  try {
    const categoryPath = path.join(DATA_DIR, 'categories.json');
    const [previousValue, previousNavigation] = await Promise.all([
      readJson(categoryPath),
      readNavigation()
    ]);
    const categoryConfig = categoryNavigation.normalizeCategoryConfiguration(previousValue);
    const label = categoryNavigation.uniqueLabel(
      categoryConfig.groups.map((group) => group?.label),
      'New Category Group'
    );
    const group = {
      id: uniqueCategoryNodeId(categoryConfig, 'category_group'),
      label,
      children: []
    };
    categoryConfig.groups.push(group);
    const normalizedConfig = categoryNavigation.normalizeCategoryConfiguration(categoryConfig);
    await writeJsonAtomic(categoryPath, normalizedConfig);
    res.status(201).json({
      categoryConfig: normalizedConfig,
      navigation: previousNavigation,
      group
    });
  } catch (error) {
    next(error);
  }
}));

app.post('/api/categories/groups/:groupId/items', transactionalJsonRoute(async (req, res, next) => {
  try {
    const categoryPath = path.join(DATA_DIR, 'categories.json');
    const [previousValue, previousNavigation, pageIndex] = await Promise.all([
      readJson(categoryPath),
      readNavigation(),
      readPageIndex()
    ]);
    const categoryConfig = categoryNavigation.normalizeCategoryConfiguration(previousValue);
    const group = findCategoryGroup(categoryConfig.groups, req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Category group not found.' });
    if (!Array.isArray(group.children)) group.children = [];
    const label = categoryNavigation.uniqueLabel(
      group.children.filter((node) => node?.type === 'item').map((item) => item.label),
      'New Category'
    );
    const item = {
      type: 'item',
      id: uniqueCategoryNodeId(categoryConfig, 'category'),
      label
    };
    group.children.push(item);
    const normalizedConfig = categoryNavigation.normalizeCategoryConfiguration(categoryConfig);
    const navigation = rebuildNavigationProjection(
      previousNavigation,
      normalizedConfig,
      pageIndex
    ).navigation;
    await writeJsonTransaction([
      { filePath: categoryPath, previousValue, nextValue: normalizedConfig },
      { filePath: NAVIGATION_PATH, previousValue: previousNavigation, nextValue: navigation }
    ]);
    res.status(201).json({
      categoryConfig: normalizedConfig,
      navigation,
      item,
      groupId: group.id
    });
  } catch (error) {
    next(error);
  }
}));

async function renameCategoryDefinition({ nodeId, nodeType, label }) {
  const categoryPath = path.join(DATA_DIR, 'categories.json');
  const [previousCategoryValue, previousNavigation] = await Promise.all([
    readJson(categoryPath),
    readNavigation()
  ]);
  const categoryConfig = categoryNavigation.normalizeCategoryConfiguration(previousCategoryValue);
  const node = nodeType === 'item'
    ? findCategoryItem(categoryConfig.groups, nodeId)
    : findCategoryGroup(categoryConfig.groups, nodeId);
  if (!node) return null;

  if (node.label === label) {
    return {
      categoryConfig,
      navigation: previousNavigation,
      [nodeType]: node
    };
  }

  node.label = label;
  const normalizedConfig = categoryNavigation.normalizeCategoryConfiguration(categoryConfig);
  if (nodeType === 'group') {
    await writeJsonAtomic(categoryPath, normalizedConfig);
    return {
      categoryConfig: normalizedConfig,
      navigation: previousNavigation,
      group: node
    };
  }

  const pageIndex = await readPageIndex();
  const navigation = rebuildNavigationProjection(
    previousNavigation,
    normalizedConfig,
    pageIndex
  ).navigation;
  await writeJsonTransaction([
    {
      filePath: categoryPath,
      previousValue: previousCategoryValue,
      nextValue: normalizedConfig
    },
    {
      filePath: NAVIGATION_PATH,
      previousValue: previousNavigation,
      nextValue: navigation
    }
  ]);
  return {
    categoryConfig: normalizedConfig,
    navigation,
    item: node
  };
}

app.patch('/api/categories/items/:categoryId', transactionalJsonRoute(async (req, res, next) => {
  try {
    const label = categoryRenameLabel(req.body?.label);
    if (!label) return res.status(400).json({ error: 'A non-empty Category label is required.' });
    const result = await renameCategoryDefinition({
      nodeId: req.params.categoryId,
      nodeType: 'item',
      label
    });
    if (!result) return res.status(404).json({ error: 'Category not found.' });
    res.json(result);
  } catch (error) {
    next(error);
  }
}));

app.patch('/api/categories/groups/:groupId', transactionalJsonRoute(async (req, res, next) => {
  try {
    const label = categoryRenameLabel(req.body?.label);
    if (!label) return res.status(400).json({ error: 'A non-empty Category label is required.' });
    const result = await renameCategoryDefinition({
      nodeId: req.params.groupId,
      nodeType: 'group',
      label
    });
    if (!result) return res.status(404).json({ error: 'Category group not found.' });
    res.json(result);
  } catch (error) {
    next(error);
  }
}));

async function deleteCategoryDefinition({ nodeId, nodeType }) {
  const categoryPath = path.join(DATA_DIR, 'categories.json');
  const pageIndexPath = path.join(DATA_DIR, 'pageIndex.json');
  const navigationPath = path.join(DATA_DIR, 'navigation.json');
  const [previousCategoryValue, previousPageIndex, previousNavigation] = await Promise.all([
    readJson(categoryPath),
    readPageIndex(),
    readJson(navigationPath)
  ]);
  const categoryConfig = categoryNavigation.normalizeCategoryConfiguration(previousCategoryValue);
  const removedNode = removeCategoryNode(categoryConfig.groups, nodeId, nodeType);
  if (!removedNode) return null;
  const removedCategoryIds = nodeType === 'item'
    ? new Set([removedNode.id])
    : collectCategoryItemIds([removedNode]);
  const normalizedConfig = categoryNavigation.normalizeCategoryConfiguration(categoryConfig);
  const workingPageIndex = cloneJson(previousPageIndex);
  const updatedPages = [];
  const pageRecords = [];
  const updatedAt = new Date().toISOString();

  for (const entry of workingPageIndex.pages || []) {
    const filePath = safePageFilePath(entry);
    const previousPage = filePath ? await readJsonIfExists(filePath) : null;
    const persistedCategories = Array.isArray(previousPage?.categories)
      ? previousPage.categories
      : Array.isArray(entry.categories)
        ? entry.categories
        : Array.isArray(entry.categoryIds) ? entry.categoryIds : [];
    const nextCategories = persistedCategories.filter((categoryId) => !removedCategoryIds.has(categoryId));
    const pageChanged = Boolean(previousPage)
      && JSON.stringify(nextCategories) !== JSON.stringify(persistedCategories);
    if (pageChanged) {
      const nextPage = cloneJson(previousPage);
      nextPage.categories = nextCategories;
      nextPage.updatedAt = updatedAt;
      pageRecords.push({ filePath, previousValue: previousPage, nextValue: nextPage });
      updatedPages.push(nextPage);
      entry.updatedAt = updatedAt;
    }
    entry.categories = nextCategories;
    entry.categoryIds = nextCategories;
  }

  const syncedNavigation = rebuildNavigationProjection(
    previousNavigation,
    normalizedConfig,
    workingPageIndex
  ).navigation;
  await writeJsonTransaction([
    ...pageRecords,
    {
      filePath: pageIndexPath,
      previousValue: previousPageIndex,
      nextValue: normalizePageIndexShape(workingPageIndex)
    },
    { filePath: categoryPath, previousValue: previousCategoryValue, nextValue: normalizedConfig },
    { filePath: navigationPath, previousValue: previousNavigation, nextValue: syncedNavigation }
  ]);
  return {
    categoryConfig: normalizedConfig,
    pageIndex: workingPageIndex,
    navigation: syncedNavigation,
    pages: updatedPages,
    removedCategoryIds: [...removedCategoryIds]
  };
}

app.delete('/api/categories/items/:categoryId', transactionalJsonRoute(async (req, res, next) => {
  try {
    const result = await deleteCategoryDefinition({
      nodeId: req.params.categoryId,
      nodeType: 'item'
    });
    if (!result) return res.status(404).json({ error: 'Category not found.' });
    res.json(result);
  } catch (error) {
    next(error);
  }
}));

app.delete('/api/categories/groups/:groupId', transactionalJsonRoute(async (req, res, next) => {
  try {
    const result = await deleteCategoryDefinition({
      nodeId: req.params.groupId,
      nodeType: 'group'
    });
    if (!result) return res.status(404).json({ error: 'Category group not found.' });
    res.json(result);
  } catch (error) {
    next(error);
  }
}));

app.get('/api/descriptors', async (req, res, next) => {
  try {
    res.json(await readDescriptorLibrary());
  } catch (error) {
    next(error);
  }
});

app.get('/api/descriptor-groups', async (req, res, next) => {
  try {
    res.json(await readDescriptorGroups());
  } catch (error) {
    next(error);
  }
});

app.put('/api/descriptor-groups', transactionalJsonRoute(async (req, res, next) => {
  try {
    const descriptorGroups = await writeDescriptorGroups(req.body || {});
    const descriptorMetadata = await commitCanonicalDescriptorMetadata([], {
      changedDomains: ['descriptorGroups'],
      includeDescriptorGroups: true
    });
    res.json({ descriptorGroups, metadataChangeSet: descriptorMetadata.metadataChangeSet });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/descriptor-sync-rules', transactionalJsonRoute(async (req, res, next) => {
  try {
    res.json(await loadDescriptorSyncRules());
  } catch (error) {
    next(error);
  }
}));

app.post('/api/descriptor-sync-index/rebuild', transactionalJsonRoute(async (req, res, next) => {
  try {
    const result = await commitCanonicalDescriptorMetadata([], {
      changedDomains: ['descriptorMetadataRebuild']
    });
    res.json({
      ...result.diagnostics.descriptorSync.projection,
      metadataChangeSet: result.metadataChangeSet
    });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/descriptor-sync-index/validate', transactionalJsonRoute(async (req, res, next) => {
  try {
    const index = await loadDescriptorSyncIndex(DESCRIPTOR_SYNC_INDEX_PATH);
    const { pageIndex, linkTypes, classIds } = await descriptorSyncIndexContext();
    const descriptorLibrary = await readDescriptorLibrary();
    const revision = metadataRevisionStatus(pageIndex, index, descriptorLibrary);
    const validation = index
      ? validateDescriptorSyncIndex(index, pageIndex, linkTypes, classIds)
      : { valid: false, warnings: ['descriptorSyncIndex is missing or malformed.'] };
    res.json({
      valid: validation.valid && revision.coherent,
      warnings: [
        ...validation.warnings,
        ...(revision.coherent ? [] : ['Descriptor metadata revisions do not form one coherent snapshot.'])
      ],
      revision
    });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/descriptor-sync-index/evaluate', transactionalJsonRoute(async (req, res, next) => {
  try {
    const index = await loadDescriptorSyncIndex(DESCRIPTOR_SYNC_INDEX_PATH);
    if (!index) {
      return res.status(503).json({
        error: 'descriptorSyncIndex is unavailable; run the explicit rebuild endpoint first.'
      });
    }
    const [rules, linkTypes, pageIndex, descriptorLibrary] = await settledValues([
      loadDescriptorSyncRules(), readLinkTypes(), readPageIndex(), readDescriptorLibrary()
    ]);
    const revision = metadataRevisionStatus(pageIndex, index, descriptorLibrary);
    if (!revision.coherent) {
      return res.status(409).json({
        error: 'Descriptor metadata projections are revision-mismatched; run the explicit rebuild endpoint.',
        revision
      });
    }
    const result = validateQueueEvaluator(index, rules, linkTypes);
    res.json({
      matchesCurrentIndex: result.comparison.matches,
      missingAuto: result.comparison.missing,
      unexpectedAuto: result.comparison.unexpected,
      differencePageIds: result.comparison.differencePageIds,
      staleIgnoredCandidates: result.staleIgnoredCandidates,
      metadataRevision: revision.metadataRevision,
      stats: result.expected.stats,
      warnings: result.expected.warnings
    });
  } catch (error) {
    next(error);
  }
}));

app.post('/api/descriptor-sync/rebuild', transactionalJsonRoute(async (req, res, next) => {
  try {
    const pageIds = Array.isArray(req.body?.pageIds)
      ? req.body.pageIds.filter((pageId) => typeof pageId === 'string')
      : [];
    if (req.query.engine === 'legacy') {
      return res.status(410).json({
        error: 'The legacy Descriptor sync engine is retired; use the canonical metadata rebuild.'
      });
    }
    const result = await commitCanonicalDescriptorMetadata(pageIds, {
      changedDomains: ['descriptorMetadataRebuild']
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}));

app.post('/api/descriptor-metadata/rebuild', transactionalJsonRoute(async (req, res, next) => {
  try {
    const result = await commitCanonicalDescriptorMetadata([], {
      changedDomains: ['descriptorMetadataRebuild']
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}));

app.get('/api/descriptor-metadata/snapshot', async (req, res, next) => {
  try {
    const [pageIndex, descriptorRegistry, descriptorGroups, vocabulary, syncIndex] = await settledValues([
      readPageIndex(),
      readDescriptorLibrary(),
      readDescriptorGroups(),
      readVocabularyLibrary(),
      readJsonIfExists(DESCRIPTOR_SYNC_INDEX_PATH)
    ]);
    const revision = metadataRevisionStatus(pageIndex, syncIndex, descriptorRegistry);
    if (!revision.coherent) {
      return res.status(409).json({
        error: 'Descriptor metadata projections are revision-mismatched; run the explicit rebuild endpoint.',
        revision
      });
    }
    const pageMetadataProjection = buildPageMetadataProjection({
      pageRecords: await loadCanonicalDescriptorPageRecords(),
      descriptorLibrary: descriptorRegistry,
      model: descriptorModel,
      metadataRevision: revision.metadataRevision
    });
    res.json({
      metadataRevision: revision.metadataRevision,
      pageMetadataProjection,
      pageIndex,
      descriptorRegistry,
      descriptorGroups,
      vocabulary
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/vocabulary', async (req, res, next) => {
  try {
    res.json(await readVocabularyLibrary());
  } catch (error) {
    next(error);
  }
});

app.put('/api/vocabulary', transactionalJsonRoute(async (req, res, next) => {
  try {
    const previousVocabulary = await readVocabularyLibrary();
    const result = validateVocabularyLibrary(req.body || {}, previousVocabulary);
    if (result.error) return res.status(400).json({ error: result.error });
    await writeVocabularyLibrary(result.library);
    const vocabulary = await readVocabularyLibrary();
    const descriptorsUpdated = await syncDescriptorDisplaysForVocabulary(vocabulary, previousVocabulary);
    const descriptorMetadata = await commitCanonicalDescriptorMetadata([], {
      changedDomains: ['vocabulary'],
      includeVocabulary: true
    });
    const committedVocabulary = descriptorMetadata.metadataChangeSet.vocabulary;
    res.json({
      ...committedVocabulary,
      descriptorsUpdated,
      metadataChangeSet: descriptorMetadata.metadataChangeSet
    });
  } catch (error) {
    next(error);
  }
}));

app.post('/api/vocabulary/move', transactionalJsonRoute(async (req, res, next) => {
  try {
    const sourceEntryId = typeof req.body?.sourceEntryId === 'string' ? req.body.sourceEntryId : '';
    const targetEntryId = typeof req.body?.targetEntryId === 'string' ? req.body.targetEntryId : '';
    if (!/^[a-z0-9_-]+$/i.test(sourceEntryId) || !/^[a-z0-9_-]+$/i.test(targetEntryId)) {
      return res.status(400).json({ error: 'Valid source and target vocabulary entry IDs are required.' });
    }
    if (sourceEntryId === targetEntryId) {
      return res.status(400).json({ error: 'Source and target vocabulary entries must be different.' });
    }

    const vocabularyLibrary = await readVocabularyLibrary();
    const sourceEntry = (vocabularyLibrary.entries || []).find((entry) => entry.id === sourceEntryId);
    const targetEntry = (vocabularyLibrary.entries || []).find((entry) => entry.id === targetEntryId);
    if (!sourceEntry || !targetEntry) {
      return res.status(404).json({ error: 'Source or target vocabulary entry was not found.' });
    }
    if ((sourceEntry.aliases || []).length) {
      return res.status(400).json({ error: 'Cannot move a word that has aliases. Set another word as display first.' });
    }

    const sourceWord = sourceEntry.display;
    if (targetEntry.display !== sourceWord && !(targetEntry.aliases || []).includes(sourceWord)) {
      targetEntry.aliases = [...(targetEntry.aliases || []), sourceWord];
    }
    vocabularyLibrary.entries = (vocabularyLibrary.entries || [])
      .filter((entry) => entry.id !== sourceEntry.id);

    const descriptorLibrary = await readDescriptorLibrary();
    const sourceDescriptors = (descriptorLibrary.entries || []).filter((descriptor) => (
      descriptor.vocabularyEntryId === sourceEntry.id
      || (!descriptor.vocabularyEntryId && descriptor.display === sourceEntry.display)
    ));
    const targetDescriptors = (descriptorLibrary.entries || []).filter((descriptor) => (
      descriptor.vocabularyEntryId === targetEntry.id
      || (!descriptor.vocabularyEntryId && descriptor.display === targetEntry.display)
    ));
    const canonicalDescriptor = targetDescriptors[0] || sourceDescriptors[0] || null;
    const descriptorIdRemap = new Map();
    const mergedDescriptors = [...targetDescriptors, ...sourceDescriptors];

    if (canonicalDescriptor) {
      canonicalDescriptor.display = targetEntry.display;
      canonicalDescriptor.vocabularyEntryId = targetEntry.id;
      canonicalDescriptor.updatedAt = new Date().toISOString();
      for (const descriptor of mergedDescriptors) {
        if (descriptor.id !== canonicalDescriptor.id) {
          descriptorIdRemap.set(descriptor.id, canonicalDescriptor.id);
        }
      }
      descriptorLibrary.entries = (descriptorLibrary.entries || [])
        .filter((descriptor) => !descriptorIdRemap.has(descriptor.id));
    }

    const updatedAt = new Date().toISOString();
    await writeVocabularyLibrary(vocabularyLibrary);
    await writeDescriptorLibrary(descriptorLibrary);
    const descriptorGroupsUpdated = await remapDescriptorGroupMembership({
      [sourceEntry.id]: targetEntry.id,
      ...Object.fromEntries(descriptorIdRemap)
    });
    const pageCleanup = await remapDescriptorIdsAcrossPages(
      descriptorIdRemap,
      descriptorLibrary,
      updatedAt
    );
    const descriptorSync = await runDescriptorSync(pageCleanup.affectedPageIds, {
      directChangedPageIds: pageCleanup.affectedPageIds,
      changedDomains: ['vocabulary', 'descriptorGroups', 'pages'],
      includeVocabulary: true,
      includeDescriptorGroups: true
    });
    const affectedPageIds = [...new Set([
      ...pageCleanup.affectedPageIds,
      ...(descriptorSync?.affectedPageIds || [])
    ])];

    res.json({
      vocabulary: await readVocabularyLibrary(),
      descriptorLibrary: await readDescriptorLibrary(),
      vocabularyEntryIdRemap: { [sourceEntry.id]: targetEntry.id },
      descriptorIdRemap: Object.fromEntries(descriptorIdRemap),
      descriptorEntryIds: canonicalDescriptor ? [canonicalDescriptor.id] : [],
      affectedPageIds,
      pagesAffected: affectedPageIds.length,
      pageDescriptorRefsRemapped: pageCleanup.pageRefCount,
      descriptorGroupsUpdated,
      descriptorSync,
      metadataChangeSet: descriptorSync.metadataChangeSet
    });
  } catch (error) {
    next(error);
  }
}));

app.delete('/api/vocabulary/:entryId', transactionalJsonRoute(async (req, res, next) => {
  try {
    if (!/^[a-z0-9_-]+$/i.test(req.params.entryId)) {
      return res.status(400).json({ error: 'A valid vocabulary entry ID is required.' });
    }

    const vocabularyLibrary = await readVocabularyLibrary();
    const entry = (vocabularyLibrary.entries || []).find((item) => item.id === req.params.entryId);
    if (!entry) return res.status(404).json({ error: 'Vocabulary entry not found.' });

    let descriptorLibrary = await readDescriptorLibrary();
    const referencedDescriptors = (descriptorLibrary.entries || [])
      .filter((descriptor) => (
        descriptor.vocabularyEntryId === entry.id
        || (!descriptor.vocabularyEntryId && descriptor.display === entry.display)
      ));
    const deletedDescriptorIds = new Set(referencedDescriptors.map((descriptor) => descriptor.id));
    const updatedAt = new Date().toISOString();

    let pageCleanup = { pageRefCount: 0, affectedPageCount: 0 };
    if (deletedDescriptorIds.size) {
      descriptorLibrary.entries = (descriptorLibrary.entries || [])
        .filter((descriptor) => !deletedDescriptorIds.has(descriptor.id));
      await writeDescriptorLibrary(descriptorLibrary);
      descriptorLibrary = await readDescriptorLibrary();
      pageCleanup = await removeDescriptorIdsFromAllPages(deletedDescriptorIds, descriptorLibrary, updatedAt);
    }

    vocabularyLibrary.entries = (vocabularyLibrary.entries || [])
      .filter((item) => item.id !== entry.id);

    await writeVocabularyLibrary(vocabularyLibrary);
    const descriptorGroupsUpdated = await removeDescriptorGroupMembership([
      entry.id,
      ...deletedDescriptorIds
    ]);
    const descriptorSync = await runDescriptorSync(pageCleanup.affectedPageIds || [], {
      directChangedPageIds: pageCleanup.affectedPageIds || [],
      changedDomains: ['vocabulary', 'descriptorGroups', 'pages'],
      includeVocabulary: true,
      includeDescriptorGroups: true
    });
    const affectedPageIds = [...new Set([
      ...(pageCleanup.affectedPageIds || []),
      ...(descriptorSync?.affectedPageIds || [])
    ])];

    res.json({
      vocabulary: await readVocabularyLibrary(),
      descriptorEntryIds: [...deletedDescriptorIds],
      descriptorsDeleted: referencedDescriptors.length,
      pageDescriptorRefsRemoved: pageCleanup.pageRefCount,
      pagesAffected: affectedPageIds.length,
      affectedPageIds,
      descriptorGroupsUpdated,
      descriptorSync,
      metadataChangeSet: descriptorSync.metadataChangeSet
    });
  } catch (error) {
    next(error);
  }
}));

app.post('/api/pages', transactionalJsonRoute(async (req, res, next) => {
  try {
    const now = new Date().toISOString();
    const navigationPath = path.join(DATA_DIR, 'navigation.json');
    const project = await readProjectFacade();
    const pageIndex = await readPageIndex();
    const navigation = normalizeNavigation(await readJson(navigationPath), pageIndex);
    const previousPageIndex = cloneJson(pageIndex);
    if (!Array.isArray(pageIndex.pages)) pageIndex.pages = [];
    const parentFolderId = req.body?.parentFolderId;
    if (parentFolderId != null && typeof parentFolderId !== 'string') {
      return res.status(400).json({ error: 'A valid parent folder ID is required.' });
    }
    const parentLocation = parentFolderId
      ? findFolderLocation(navigation.folders, parentFolderId)
      : null;
    const parentFolder = parentLocation?.folder || null;
    if (parentFolderId && (!parentFolder
      || parentFolder.type !== 'manual'
      || parentFolder.source?.kind !== 'manual')) {
      return res.status(400).json({ error: 'New pages can only be created inside a manual folder.' });
    }

    const title = uniqueUntitledTitle(pageIndex.pages);
    const pageId = await uniqueDatedPageId(pageIndex.pages);
    const relativePath = `pages/${pageId}.json`;
    const { defaultPageType } = await readVaultPreferences();
    const page = newEmptyPageRecord(pageId, title, now, defaultPageType);
    const indexEntry = newPageIndexEntry(pageId, title, relativePath, now, defaultPageType);

    pageIndex.pages.push(indexEntry);
    project.lastOpenedPageId = pageId;
    if (parentFolder) {
      manualFolderPageIds(parentFolder).push(pageId);
      parentFolder.collapsed = false;
    }

    await writeJson(path.join(DATA_DIR, relativePath), page);
    const projectedNavigation = NavigationProjection.updatePages({
      navigation,
      previousPageIndex,
      pageIndex,
      changes: [{
        id: pageId,
        before: null,
        after: indexEntry,
        membershipChanged: true,
        presentationChanged: true
      }]
    }).navigation;
    await writeJson(navigationPath, projectedNavigation);
    await writeProjectFacade(project);
    const descriptorSync = await runDescriptorSync([page.id], {
      workingPageIndex: pageIndex,
      directChangedPageIds: [page.id],
      changedDomains: ['pages']
    });

    res.status(201).json({
      page,
      pageEntry: indexEntry,
      pageIndex: descriptorSync.pageIndex,
      navigation: projectedNavigation,
      project,
      descriptorSync,
      metadataChangeSet: descriptorSync.metadataChangeSet
    });
  } catch (error) {
    next(error);
  }
}));

app.post('/api/pages/:pageId/blocks/:blockId/new-page-link', transactionalJsonRoute(async (req, res, next) => {
  try {
    if (!/^[a-z0-9_-]+$/i.test(req.params.pageId)
      || !/^[a-z0-9_-]+$/i.test(req.params.blockId)) {
      return res.status(400).json({ error: 'A valid page and block ID are required.' });
    }

    const linkTypes = await readLinkTypes();
    const linkTypeId = typeof req.body.linkTypeId === 'string'
      ? req.body.linkTypeId
      : linkTypes.defaultLinkTypeId || 'contains';
    if (!linkTypeById(linkTypes).has(linkTypeId)) {
      return res.status(400).json({ error: 'Unknown link type.' });
    }

    const sourcePath = await pagePath(req.params.pageId);
    if (!sourcePath) return res.status(404).json({ error: 'Page not found in page index.' });

    const now = new Date().toISOString();
    const navigationPath = path.join(DATA_DIR, 'navigation.json');
    const project = await readProjectFacade();
    const pageIndex = await readPageIndex();
    const navigation = normalizeNavigation(await readJson(navigationPath), pageIndex);
    const previousPageIndex = cloneJson(pageIndex);
    if (!Array.isArray(pageIndex.pages)) pageIndex.pages = [];

    const sourcePage = normalizePageShape(await readJson(sourcePath));
    if (rejectUnsupportedPageForApi(res, sourcePage)) return;
    const previousPage = cloneJson(sourcePage);
    const block = (sourcePage.blocks || []).find((item) => item.id === req.params.blockId);
    if (!block) return res.status(404).json({ error: 'Block not found.' });
    if (!Array.isArray(block.links)) block.links = [];
    const title = uniqueUntitledTitle(pageIndex.pages);
    const pageId = await uniqueDatedPageId(pageIndex.pages);
    const relativePath = `pages/${pageId}.json`;
    const { defaultPageType } = await readVaultPreferences();
    const targetPage = newEmptyPageRecord(pageId, title, now, defaultPageType);
    const indexEntry = newPageIndexEntry(pageId, title, relativePath, now, defaultPageType);
    const link = {
      id: uniqueBlockPageLinkId(sourcePage, block, pageId),
      type: linkTypeId,
      linkTypeId,
      targetType: 'page',
      targetPageId: pageId,
      label: title
    };
    block.links.push(link);

    const backlink = backlinkFromLink({
      sourcePageId: sourcePage.id,
      sourceBlockId: block.id,
      sourceLinkId: link.id,
      targetPageId: pageId,
      targetType: 'page',
      linkTypeId,
      linkType: link.type,
      label: link.label,
      sourcePageTitle: sourcePage.title
    }, now, linkTypes);
    targetPage.backlinks = dedupeBacklinks([backlink]);

    sourcePage.updatedAt = now;
    pageIndex.pages.push(indexEntry);
    touchPageIndexEntries(pageIndex, new Set([sourcePage.id]), now);
    project.lastOpenedPageId = pageId;

    await writeJson(sourcePath, sourcePage);
    await writeJson(path.join(DATA_DIR, relativePath), targetPage);
    const projectedNavigation = NavigationProjection.updatePages({
      navigation,
      previousPageIndex,
      pageIndex,
      changes: [{
        id: pageId,
        before: null,
        after: indexEntry,
        membershipChanged: true,
        presentationChanged: true
      }]
    }).navigation;
    await writeJson(navigationPath, projectedNavigation);
    await writeProjectFacade(project);
    const descriptorSync = await runDescriptorSync([sourcePage.id, targetPage.id], {
      workingPageIndex: pageIndex,
      directChangedPageIds: [sourcePage.id, targetPage.id],
      changedDomains: ['pages', 'relations']
    });
    const syncedPageIndex = await readPageIndex();

    res.status(201).json({
      page: await readJson(path.join(DATA_DIR, relativePath)),
      sourcePage: await readJson(sourcePath),
      pageEntry: syncedPageIndex.pages.find((page) => page.id === targetPage.id),
      pageIndex: syncedPageIndex,
      navigation: projectedNavigation,
      project,
      link,
      backlink,
      descriptorSync,
      metadataChangeSet: descriptorSync.metadataChangeSet
    });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Page not found.' });
    next(error);
  }
}));

app.post('/api/pages/:pageId/blocks/:blockId/page-link', transactionalJsonRoute(async (req, res, next) => {
  try {
    if (!/^[a-z0-9_-]+$/i.test(req.params.pageId)
      || !/^[a-z0-9_-]+$/i.test(req.params.blockId)) {
      return res.status(400).json({ error: 'A valid page and block ID are required.' });
    }
    if (typeof req.body.targetPageId !== 'string'
      || !/^[a-z0-9_-]+$/i.test(req.body.targetPageId)) {
      return res.status(400).json({ error: 'A valid target page ID is required.' });
    }
    if (req.params.pageId === req.body.targetPageId) {
      return res.status(400).json({ error: 'A page cannot link to itself.' });
    }

    const linkTypes = await readLinkTypes();
    const linkTypeId = typeof req.body.linkTypeId === 'string'
      ? req.body.linkTypeId
      : linkTypes.defaultLinkTypeId || 'contains';
    if (!linkTypeById(linkTypes).has(linkTypeId)) {
      return res.status(400).json({ error: 'Unknown link type.' });
    }

    const sourcePath = await pagePath(req.params.pageId);
    if (!sourcePath) return res.status(404).json({ error: 'Source page not found.' });

    const pageIndex = await readPageIndex();
    const targetEntry = (pageIndex.pages || []).find((page) => page.id === req.body.targetPageId);
    const targetPath = safePageFilePath(targetEntry);
    if (!targetEntry || !targetPath || !await readJsonIfExists(targetPath)) {
      return res.status(404).json({ error: 'Target page not found.' });
    }

    const now = new Date().toISOString();
    const sourcePage = normalizePageShape(await readJson(sourcePath));
    if (rejectUnsupportedPageForApi(res, sourcePage)) return;
    const previousPage = cloneJson(sourcePage);
    const block = (sourcePage.blocks || []).find((item) => item.id === req.params.blockId);
    if (!block) return res.status(404).json({ error: 'Block not found.' });
    if (!Array.isArray(block.links)) block.links = [];
    if (block.links.some((link) => link.targetType === 'page'
      && link.targetPageId === req.body.targetPageId)) {
      return res.status(409).json({ error: 'This block already links to that page.' });
    }
    const targetTitle = targetEntry.title || req.body.targetPageId;
    const link = {
      id: uniqueBlockPageLinkId(sourcePage, block, req.body.targetPageId),
      type: linkTypeId,
      linkTypeId,
      targetType: 'page',
      targetPageId: req.body.targetPageId,
      label: targetTitle
    };
    block.links.push(link);
    sourcePage.updatedAt = now;

    await writeJson(sourcePath, sourcePage);
    await syncBacklinksForPageLinks(previousPage, sourcePage, now);
    applyPageIndexChanges(pageIndex, sourcePage.id, { updatedAt: now });
    const descriptorSync = await runDescriptorSync([
      sourcePage.id,
      req.body.targetPageId
    ], {
      workingPageIndex: pageIndex,
      directChangedPageIds: [sourcePage.id],
      changedDomains: ['pages', 'relations']
    });

    res.status(201).json({
      page: await readJson(sourcePath),
      pageIndex: await readPageIndex(),
      navigation: await readNavigation(),
      link,
      descriptorSync,
      metadataChangeSet: descriptorSync.metadataChangeSet
    });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Page not found.' });
    next(error);
  }
}));

app.delete('/api/pages/:pageId/blocks/:blockId/links/:linkId', transactionalJsonRoute(async (req, res, next) => {
  try {
    if (!/^[a-z0-9_-]+$/i.test(req.params.pageId)
      || !/^[a-z0-9_-]+$/i.test(req.params.blockId)
      || !/^[a-z0-9_-]+$/i.test(req.params.linkId)) {
      return res.status(400).json({ error: 'A valid page, block, and link ID are required.' });
    }

    const sourcePath = await pagePath(req.params.pageId);
    if (!sourcePath) return res.status(404).json({ error: 'Source page not found.' });

    const sourcePage = normalizePageShape(await readJson(sourcePath));
    if (rejectUnsupportedPageForApi(res, sourcePage)) return;
    const previousPage = cloneJson(sourcePage);
    const block = (sourcePage.blocks || []).find((item) => item.id === req.params.blockId);
    if (!block || !Array.isArray(block.links)) return res.status(404).json({ error: 'Link not found.' });

    const deletedLink = block.links.find((link) => link.id === req.params.linkId);
    const beforeLength = block.links.length;
    block.links = block.links.filter((link) => link.id !== req.params.linkId);
    if (block.links.length === beforeLength) return res.status(404).json({ error: 'Link not found.' });

    const updatedAt = new Date().toISOString();
    sourcePage.updatedAt = updatedAt;
    await writeJson(sourcePath, sourcePage);
    await syncBacklinksForPageLinks(previousPage, sourcePage, updatedAt);
    const workingPageIndex = await readPageIndex();
    applyPageIndexChanges(workingPageIndex, sourcePage.id, { updatedAt });
    const descriptorSync = await runDescriptorSync([
      sourcePage.id,
      deletedLink?.targetPageId
    ].filter(Boolean), {
      workingPageIndex,
      directChangedPageIds: [sourcePage.id],
      changedDomains: ['pages', 'relations']
    });

    res.json({
      page: await readJson(sourcePath),
      pageIndex: await readPageIndex(),
      navigation: await readNavigation(),
      deletedLinkId: req.params.linkId,
      descriptorSync,
      metadataChangeSet: descriptorSync.metadataChangeSet
    });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Page not found.' });
    next(error);
  }
}));

function externalLinkMutationDraft(body, page) {
  const validated = validateExternalLinkDraft(body);
  if (!validated.valid) return validated;
  const sourceBlockId = typeof body?.sourceBlockId === 'string' && body.sourceBlockId.trim()
    ? body.sourceBlockId.trim()
    : null;
  if (sourceBlockId && !(page.blocks || []).some((block) => block.id === sourceBlockId)) {
    return { valid: false, error: 'Source Block not found.' };
  }
  return { valid: true, value: { ...validated.value, sourceBlockId } };
}

async function persistExternalLinkMutation(pagePathname, page, updatedAt) {
  page.updatedAt = updatedAt;
  await writeJsonAtomic(pagePathname, page);
  await updatePageIndex(page.id, { updatedAt });
}

app.post('/api/pages/:pageId/external-links', transactionalJsonRoute(async (req, res, next) => {
  try {
    if (!/^[a-z0-9_-]+$/i.test(req.params.pageId)) {
      return res.status(400).json({ error: 'A valid page ID is required.' });
    }
    const filePath = await pagePath(req.params.pageId);
    if (!filePath) return res.status(404).json({ error: 'Page not found.' });
    const page = normalizePageShape(await readJson(filePath));
    if (rejectUnsupportedPageForApi(res, page)) return;
    const draft = externalLinkMutationDraft(req.body, page);
    if (!draft.valid) return res.status(400).json({ error: draft.error });
    const now = new Date().toISOString();
    const externalLink = {
      id: `external_${crypto.randomUUID().replace(/-/g, '')}`,
      ...draft.value,
      createdAt: now,
      updatedAt: now
    };
    page.externalLinks.push(externalLink);
    await persistExternalLinkMutation(filePath, page, now);
    res.status(201).json({ page, externalLink });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Page not found.' });
    next(error);
  }
}));

app.patch('/api/pages/:pageId/external-links/:externalLinkId', transactionalJsonRoute(async (req, res, next) => {
  try {
    if (!/^[a-z0-9_-]+$/i.test(req.params.pageId)
      || !/^external_[a-z0-9_-]+$/i.test(req.params.externalLinkId)) {
      return res.status(400).json({ error: 'A valid page and External Link ID are required.' });
    }
    const filePath = await pagePath(req.params.pageId);
    if (!filePath) return res.status(404).json({ error: 'Page not found.' });
    const page = normalizePageShape(await readJson(filePath));
    if (rejectUnsupportedPageForApi(res, page)) return;
    const index = page.externalLinks.findIndex((item) => item.id === req.params.externalLinkId);
    if (index < 0) return res.status(404).json({ error: 'External Link not found.' });
    const existing = page.externalLinks[index];
    const draft = externalLinkMutationDraft({
      ...req.body,
      sourceBlockId: Object.hasOwn(req.body || {}, 'sourceBlockId')
        ? req.body.sourceBlockId
        : existing.sourceBlockId
    }, page);
    if (!draft.valid) return res.status(400).json({ error: draft.error });
    const now = new Date().toISOString();
    const externalLink = {
      id: existing.id,
      ...draft.value,
      createdAt: existing.createdAt || now,
      updatedAt: now
    };
    page.externalLinks[index] = externalLink;
    await persistExternalLinkMutation(filePath, page, now);
    res.json({ page, externalLink });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Page not found.' });
    next(error);
  }
}));

app.delete('/api/pages/:pageId/external-links/:externalLinkId', transactionalJsonRoute(async (req, res, next) => {
  try {
    if (!/^[a-z0-9_-]+$/i.test(req.params.pageId)
      || !/^external_[a-z0-9_-]+$/i.test(req.params.externalLinkId)) {
      return res.status(400).json({ error: 'A valid page and External Link ID are required.' });
    }
    const filePath = await pagePath(req.params.pageId);
    if (!filePath) return res.status(404).json({ error: 'Page not found.' });
    const page = normalizePageShape(await readJson(filePath));
    if (rejectUnsupportedPageForApi(res, page)) return;
    const before = page.externalLinks.length;
    page.externalLinks = page.externalLinks.filter((item) => item.id !== req.params.externalLinkId);
    if (page.externalLinks.length === before) {
      return res.status(404).json({ error: 'External Link not found.' });
    }
    const now = new Date().toISOString();
    await persistExternalLinkMutation(filePath, page, now);
    res.json({ page, deletedExternalLinkId: req.params.externalLinkId });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Page not found.' });
    next(error);
  }
}));

app.get('/api/pages/orphans', async (req, res, next) => {
  try {
    res.json(await auditOrphanPageFiles(await readPageIndex()));
  } catch (error) {
    next(error);
  }
});

app.get('/api/pages/:pageId', transactionalJsonRoute(async (req, res, next) => {
  try {
    const filePath = await pagePath(req.params.pageId, req.query.path);
    if (!filePath) return res.status(404).json({ error: 'Page not found in page index.' });
    const page = normalizePageShape(await readJson(filePath));
    if (rejectUnsupportedPageForApi(res, page)) return;
    repairImportedOriginalNames(page);
    await repairImportedImageDisplaySizes(page);
    res.json(page);
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Page not found.' });
    next(error);
  }
}));

app.get('/api/pages/:pageId/type-eligibility', async (req, res, next) => {
  try {
    const filePath = await pagePath(req.params.pageId, req.query.path);
    if (!filePath) return res.status(404).json({ error: 'Page not found in page index.' });
    const page = normalizePageShape(await readJson(filePath));
    if (rejectUnsupportedPageForApi(res, page)) return;
    return res.json({
      pageId: page.id,
      currentType: page.type,
      targets: Object.fromEntries(pageTypesForMenu().map(({ id }) => [
        id,
        conversionEligibility(page, id)
      ]))
    });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Page not found.' });
    return next(error);
  }
});

app.post('/api/pages/:pageId/type', transactionalJsonRoute(async (req, res, next) => {
  try {
    const targetType = req.body?.type;
    if (!pageTypeDefinition(targetType)) {
      return res.status(400).json({ error: 'Page type must be a registered Page Type.' });
    }
    const filePath = await pagePath(req.params.pageId, req.query.path);
    if (!filePath) return res.status(404).json({ error: 'Page not found in page index.' });
    const previousPage = normalizePageShape(await readJson(filePath));
    if (rejectUnsupportedPageForApi(res, previousPage)) return;
    const conversion = convertPage(previousPage, targetType);
    if (!conversion.ok) {
      return res.status(409).json({
        error: 'Page type conversion would require content migration.',
        reasons: conversion.reasons,
        eligibility: { allowed: false, reasons: conversion.reasons }
      });
    }

    const page = conversion.page;
    const pageIndex = await readPageIndex();
    const updatedAt = new Date().toISOString();
    page.updatedAt = updatedAt;
    applyPageIndexChanges(pageIndex, page.id, {
      type: page.type,
      updatedAt
    });
    try {
      await writeJsonAtomic(filePath, page);
      await writeJsonAtomic(
        path.join(DATA_DIR, 'pageIndex.json'),
        normalizePageIndexShape(pageIndex)
      );
    } catch (error) {
      await writeJsonAtomic(filePath, previousPage).catch((rollbackError) => {
        console.error(`Failed to roll back Page type conversion for ${page.id}:`, rollbackError);
      });
      throw error;
    }
    return res.json(page);
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Page not found.' });
    return next(error);
  }
}));

app.post('/api/pages/categories/batch', transactionalJsonRoute(async (req, res, next) => {
  try {
    const rawPageIds = req.body?.pageIds;
    const pageIds = categoryBatch.normalizeStableIds(rawPageIds);
    if (!Array.isArray(rawPageIds) || pageIds.length !== rawPageIds.length || pageIds.length < 2) {
      return res.status(400).json({ error: 'At least two valid Page IDs are required.' });
    }

    const addCategoryIds = await validatedCategories(req.body?.addCategoryIds);
    const removeCategoryIds = await validatedCategories(req.body?.removeCategoryIds);
    if (!addCategoryIds || !removeCategoryIds) {
      return res.status(400).json({ error: 'Invalid category instructions.' });
    }
    const removeIds = new Set(removeCategoryIds);
    if (addCategoryIds.some((categoryId) => removeIds.has(categoryId))) {
      return res.status(400).json({ error: 'A category cannot be added and removed together.' });
    }

    const originalPageIndex = await readPageIndex();
    const workingPageIndex = cloneJson(originalPageIndex);
    const entriesById = new Map((originalPageIndex.pages || []).map((entry) => [entry.id, entry]));
    const stalePageIds = [];
    const plannedWrites = [];
    const updatedAt = new Date().toISOString();

    for (const pageId of pageIds) {
      const entry = entriesById.get(pageId);
      const filePath = safePageFilePath(entry);
      const rawPage = filePath ? await readJsonIfExists(filePath) : null;
      if (!entry || !filePath || !rawPage || rawPage.id !== pageId) {
        stalePageIds.push(pageId);
        continue;
      }

      const originalPage = normalizePageShape(cloneJson(rawPage));
      if (rejectUnsupportedPageForApi(res, originalPage)) return;
      const nextCategories = categoryBatch.applyCategoryInstructions(
        originalPage.categories,
        addCategoryIds,
        removeCategoryIds
      );
      if (JSON.stringify(nextCategories) === JSON.stringify(originalPage.categories || [])) continue;

      const nextPage = cloneJson(originalPage);
      nextPage.categories = nextCategories;
      nextPage.updatedAt = updatedAt;
      applyPageIndexChanges(workingPageIndex, pageId, {
        categories: nextCategories,
        categoryIds: nextCategories,
        updatedAt
      });
      plannedWrites.push({ filePath, originalPage: rawPage, nextPage });
    }

    const rawNavigation = await readJsonIfExists(NAVIGATION_PATH) || samples['navigation.json'];
    const projection = NavigationProjection.updatePages({
      navigation: rawNavigation,
      previousPageIndex: originalPageIndex,
      pageIndex: workingPageIndex,
      changes: plannedWrites.map(({ originalPage, nextPage }) => ({
        id: nextPage.id,
        before: originalPage,
        after: nextPage,
        membershipChanged: true,
        presentationChanged: false
      }))
    });
    const responseNavigation = projection.navigation;
    const responseBody = {
      pages: plannedWrites.map(({ nextPage }) => nextPage),
      pageIndex: workingPageIndex,
      navigation: responseNavigation,
      changedPageIds: plannedWrites.map(({ nextPage }) => nextPage.id),
      stalePageIds
    };

    const writtenPages = [];
    try {
      for (const planned of plannedWrites) {
        await writeJsonAtomic(planned.filePath, planned.nextPage);
        writtenPages.push(planned);
      }
      if (projection.changed) await writeJsonAtomic(NAVIGATION_PATH, responseNavigation);
      if (plannedWrites.length) {
        const descriptorMetadata = await runDescriptorSync(responseBody.changedPageIds, {
          workingPageIndex,
          directChangedPageIds: responseBody.changedPageIds,
          changedDomains: ['pages', 'categories']
        });
        responseBody.pageIndex = descriptorMetadata.pageIndex;
        responseBody.metadataChangeSet = descriptorMetadata.metadataChangeSet;
      } else {
        responseBody.metadataChangeSet = null;
      }
    } catch (error) {
      for (const planned of writtenPages.reverse()) {
        await writeJsonAtomic(planned.filePath, planned.originalPage).catch((rollbackError) => {
          console.error(`Failed to roll back batch Category update for ${planned.nextPage.id}:`, rollbackError);
        });
      }
      throw error;
    }

    res.json(responseBody);
  } catch (error) {
    next(error);
  }
}));

app.post('/api/pages/:pageId', transactionalJsonRoute(async (req, res, next) => {
  try {
    const filePath = await pagePath(req.params.pageId, req.query.path);
    if (!filePath) return res.status(404).json({ error: 'Page not found in page index.' });
    const page = normalizePageShape(await readJson(filePath));
    const previousPage = cloneJson(page);
    const savesTitle = Object.hasOwn(req.body, 'title');
    const savesObjects = Object.hasOwn(req.body, 'objects');
    const savesBlocks = Object.hasOwn(req.body, 'blocks');
    const savesHighlightGroups = Object.hasOwn(req.body, 'highlightGroups');
    const savesCategories = Object.hasOwn(req.body, 'categories');
    const savesDescriptors = Object.hasOwn(req.body, 'descriptors');
    const savesIgnoredDescriptors = Object.hasOwn(req.body, 'ignoredDescriptors');
    const savesIgnoredManualEntryIds = Object.hasOwn(req.body, 'ignoredManualEntryIds');
    const savesDescriptorGroups = Object.hasOwn(req.body, 'descriptorGroups');
    const typeOwnedSaveFields = registeredPartialSaveFields()
      .filter((field) => Object.hasOwn(req.body, field));
    const savesHnText = page.type === PAGE_TYPES.HN_TEXT
      && Object.hasOwn(req.body, 'cneText');
    if (rejectUnsupportedPageForApi(res, page)) return;
    if (!savesTitle && !savesObjects && !savesBlocks && !savesHighlightGroups
      && !savesCategories && !savesDescriptors
      && !savesIgnoredDescriptors && !savesIgnoredManualEntryIds
      && !savesDescriptorGroups
      && !typeOwnedSaveFields.length) {
      return res.status(400).json({ error: 'No supported page changes were provided.' });
    }

    let hnTextSave = null;
    if (savesHnText) {
      hnTextSave = planHnTextRevisionSave(
        page.cneText,
        req.body.cneText,
        req.body.baseRevision
      );
      if (!hnTextSave.ok) {
        const response = { error: hnTextSave.error };
        for (const field of [
          'code',
          'baseRevision',
          'currentRevision',
          'readOnly',
          'errors'
        ]) {
          if (Object.hasOwn(hnTextSave, field)) response[field] = hnTextSave[field];
        }
        return res.status(hnTextSave.status).json(response);
      }
    }

    for (const field of typeOwnedSaveFields) {
      if (savesHnText && field === 'cneText') continue;
      const validation = validatePageTypePartialSave(page, field, req.body[field]);
      if (!validation.ok) return res.status(400).json({ error: validation.error });
      page[field] = validation.value;
    }

    if ((savesObjects || savesBlocks || savesHighlightGroups)
      && !pageTypeSupports(page.type, 'canvas')) {
      return res.status(400).json({ error: 'This Page Type does not support Canvas content.' });
    }

    if (hnTextSave) page.cneText = hnTextSave.value;

    if (savesTitle) {
      if (typeof req.body.title !== 'string' || !req.body.title.trim()) {
        return res.status(400).json({ error: 'A non-empty title is required.' });
      }
      const pageIndex = await readPageIndex();
      page.title = makeUniquePageTitle(pageIndex, req.body.title, req.params.pageId);
    }

    if (savesObjects) {
      const objects = validatedObjectLayout(req.body.objects, page, {
        allowSetChanges: req.body.allowObjectSetChanges === true
      });
      if (!objects) return res.status(400).json({ error: 'Invalid Object layout data.' });
      page.objects = objects;
    }

    if (savesBlocks) {
      const blocks = validatedBlocks(req.body.blocks, page);
      if (!blocks) return res.status(400).json({ error: 'Invalid block data.' });
      page.blocks = blocks;
    }

    if (savesHighlightGroups) {
      const highlightGroups = validatedHighlightGroups(
        req.body.highlightGroups,
        page.blocks,
        page.highlightGroups
      );
      if (!highlightGroups) {
        return res.status(400).json({ error: 'Invalid Highlight Group data.' });
      }
      page.highlightGroups = highlightGroups;
    } else if (savesBlocks) {
      const highlightGroups = validatedHighlightGroups(page.highlightGroups, page.blocks);
      page.highlightGroups = highlightGroups || [];
    }

    if (savesCategories) {
      const categories = await validatedCategories(req.body.categories);
      if (!categories) return res.status(400).json({ error: 'Invalid category data.' });
      page.categories = categories;
    }

    let savedDescriptorGroups = null;
    if (savesDescriptorGroups) {
      const validation = validateDescriptorGroups(req.body.descriptorGroups);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.errors.join(' ') });
      }
      savedDescriptorGroups = await writeDescriptorGroups(validation.config);
    }

    const updatedAt = new Date().toISOString();
    let descriptorLibrary = null;
    let vocabularyLibrary = null;
    let descriptorLibrariesChanged = false;
    if (savesDescriptors) {
      descriptorLibrary = await readDescriptorLibrary();
      vocabularyLibrary = await readVocabularyLibrary();
      page.descriptors = saveDescriptorDraft(req.body.descriptors, descriptorLibrary, vocabularyLibrary, updatedAt);
      descriptorLibrariesChanged = true;
    }
    if (savesIgnoredDescriptors) {
      descriptorLibrary ||= await readDescriptorLibrary();
      vocabularyLibrary ||= await readVocabularyLibrary();
      descriptorLibrariesChanged = materializeDescriptorDraftDefinitions(
        req.body.ignoredDescriptors,
        descriptorLibrary,
        vocabularyLibrary,
        updatedAt
      ) || descriptorLibrariesChanged;
      page.ignoredDescriptors = normalizeIgnoredDescriptors(req.body.ignoredDescriptors, descriptorLibrary);
    } else {
      page.ignoredDescriptors = normalizeIgnoredDescriptors(page.ignoredDescriptors, descriptorLibrary || undefined);
    }
    page.ignoredDescriptors = clearIgnoredManualOverrides(page.ignoredDescriptors, page.descriptors);
    page.ignoredManualEntryIds = normalizeIgnoredManualEntryIds(
      savesIgnoredManualEntryIds
        ? req.body.ignoredManualEntryIds
        : page.ignoredManualEntryIds,
      savesIgnoredDescriptors ? req.body.ignoredDescriptors : page.ignoredDescriptors,
      descriptorLibrary || undefined
    );
    if (descriptorLibrariesChanged) {
      await writeVocabularyLibrary(vocabularyLibrary);
      await writeDescriptorLibrary(descriptorLibrary);
    }
    page.ignoredManualEntryIds = normalizeIgnoredManualEntryIds(
      page.ignoredManualEntryIds,
      page.ignoredDescriptors,
      descriptorLibrary || undefined
    );

    repairImportedOriginalNames(page);
    await repairImportedImageDisplaySizes(page);
    page.updatedAt = updatedAt;
    if (savesHnText) await writeJsonAtomic(filePath, page);
    else await writeJson(filePath, page);
    if (savesBlocks) await syncBacklinksForPageLinks(previousPage, page, updatedAt);

    const indexChanges = { updatedAt };
    if (savesTitle) indexChanges.title = page.title;
    if (savesCategories) {
      indexChanges.categories = page.categories;
      indexChanges.categoryIds = page.categories;
    }
    if (savesDescriptors) {
      indexChanges.descriptors = pageIndexDescriptorGroups(page.descriptors, descriptorLibrary);
      indexChanges.descriptorIds = flattenedDescriptorIds(page.descriptors, descriptorLibrary);
    }
    const originalPageIndex = await readPageIndex();
    const workingPageIndex = cloneJson(originalPageIndex);
    applyPageIndexChanges(workingPageIndex, req.params.pageId, indexChanges);
    let descriptorMetadata = null;
    if (savesDescriptors || savesIgnoredDescriptors || savesIgnoredManualEntryIds
      || savesBlocks || savesCategories || savesDescriptorGroups) {
      const syncStartPageIds = new Set([
        page.id,
        ...relatedPageIds(previousPage),
        ...relatedPageIds(page)
      ]);
      descriptorMetadata = await runDescriptorSync([...syncStartPageIds], {
        workingPageIndex,
        directChangedPageIds: [page.id],
        changedDomains: [
          ...(savesDescriptors || savesIgnoredDescriptors || savesIgnoredManualEntryIds
            ? ['descriptors'] : []),
          ...(savesBlocks ? ['relations'] : []),
          ...(savesCategories ? ['categories'] : []),
          ...(savesDescriptorGroups ? ['descriptorGroups'] : [])
        ],
        includeVocabulary: descriptorLibrariesChanged,
        includeDescriptorGroups: savesDescriptorGroups
      });
    } else {
      if (savesHnText) {
        await writeJsonAtomic(
          path.join(DATA_DIR, 'pageIndex.json'),
          normalizePageIndexShape(workingPageIndex)
        );
      } else {
        await writePageIndex(workingPageIndex);
      }
    }
    if (savesTitle || savesCategories) {
      const projection = NavigationProjection.updatePages({
        navigation: await readNavigation(),
        previousPageIndex: originalPageIndex,
        pageIndex: workingPageIndex,
        changes: [{
          id: page.id,
          before: previousPage,
          after: page,
          membershipChanged: savesCategories,
          presentationChanged: savesTitle
        }]
      });
      await persistNavigationProjection(projection);
    }
    const savedPage = await readJson(filePath);
    res.json({
      page: savedPage,
      metadataChangeSet: descriptorMetadata?.metadataChangeSet || null,
      ...(savedDescriptorGroups ? { descriptorGroups: savedDescriptorGroups } : {})
    });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Page not found.' });
    next(error);
  }
}));

app.post('/api/pages/:pageId/import', transactionalJsonRoute(async (req, res, next) => {
  try {
    if (!/^[a-z0-9_-]+$/i.test(req.params.pageId)) {
      return res.status(400).json({ error: 'A valid page ID is required.' });
    }

    const filePath = await pagePath(req.params.pageId);
    if (!filePath) return res.status(404).json({ error: 'Page not found in page index.' });

    const { fields, files } = await parseMultipartRequest(req);
    const importTarget = fields.importTarget === 'maintenance' ? 'maintenance' : 'canvas';
    if (!files.length) return res.status(400).json({ error: 'No file was uploaded.' });

    const page = normalizePageShape(await readJson(filePath));
    if (rejectUnsupportedPageForApi(res, page)) return;
    if (!pageTypeSupports(page.type, 'file-import')) {
      return res.status(400).json({ error: 'This Page Type does not support file import.' });
    }
    const now = new Date().toISOString();
    const imported = [];
    const cleanupWarnings = cleanupDuplicateImportedItems(page);
    for (const file of files) {
      if (!file.size) continue;
      imported.push(await importFileToPage(page, file, importTarget, now, {
        replaceItemId: fields.replaceItemId,
        replaceItemKind: fields.replaceItemKind
      }));
    }

    if (!imported.length) return res.status(400).json({ error: 'Uploaded file was empty.' });

    repairImportedOriginalNames(page);
    await repairImportedImageDisplaySizes(page);
    page.updatedAt = now;
    await writeJson(filePath, page);
    const workingPageIndex = await readPageIndex();
    applyPageIndexChanges(workingPageIndex, req.params.pageId, { updatedAt: now });
    const descriptorMetadata = await runDescriptorSync([page.id], {
      workingPageIndex,
      directChangedPageIds: [page.id],
      changedDomains: ['pages', 'imports']
    });
    res.json({
      page: await readJson(filePath),
      imported,
      pageIndex: descriptorMetadata.pageIndex,
      warnings: cleanupWarnings,
      metadataChangeSet: descriptorMetadata.metadataChangeSet
    });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Page not found.' });
    if (error.status) {
      return res.status(error.status).json({
        error: error.message,
        duplicate: error.duplicate || null
      });
    }
    next(error);
  }
}));

app.post('/api/pages/:pageId/add-files', transactionalJsonRoute(async (req, res, next) => {
  try {
    if (!desktopMutationAuthorized(
      configuredDesktopMutationToken,
      req.get('x-viewer-desktop-token')
    )) {
      return res.status(403).json({ error: 'Add File is available in the desktop app.' });
    }
    if (!/^[a-z0-9_-]+$/i.test(req.params.pageId)) {
      return res.status(400).json({ error: 'A valid page ID is required.' });
    }
    if (!Array.isArray(req.body.files) || !req.body.files.length) {
      return res.status(400).json({ error: 'No files were selected.' });
    }
    if (req.body.files.length > 100) {
      return res.status(400).json({ error: 'Add at most 100 files at once.' });
    }
    const filePath = await pagePath(req.params.pageId);
    if (!filePath) return res.status(404).json({ error: 'Page not found in page index.' });
    const page = normalizePageShape(await readJson(filePath));
    if (rejectUnsupportedPageForApi(res, page)) return;
    if (!pageTypeSupports(page.type, 'file-import')) {
      return res.status(400).json({ error: 'This Page Type does not support file import.' });
    }
    const resolveLocation = requireConfiguredResourceResolver();
    const prepared = [];

    for (const selected of req.body.files) {
      const location = normalizeResourceLocation(selected?.location || selected);
      if (!['vault', 'workspace', 'folder'].includes(location.type)) {
        return res.status(400).json({ error: 'Files must use a managed resource location.' });
      }
      const resolved = await resolveLocation(location);
      const stat = await fs.stat(resolved.absolutePath);
      if (!stat.isFile()) {
        return res.status(400).json({ error: 'A selected original resource is not a file.' });
      }
      const originalName = normalizeImportedFilename(path.posix.basename(location.relativePath));
      const mimeType = mimeTypeForResource({ originalName }, resolved.absolutePath);
      const typeInfo = detectImportedFileType({ originalName, mimeType });
      prepared.push({
        location,
        originalName,
        mimeType,
        size: stat.size,
        buffer: typeInfo.displayable ? await fs.readFile(resolved.absolutePath) : null
      });
    }
    const now = new Date().toISOString();
    const rawPlacementCenter = req.body?.placementCenter;
    const placementCenter = rawPlacementCenter
      && Number.isFinite(rawPlacementCenter.x) && Number.isFinite(rawPlacementCenter.y)
      ? { x: rawPlacementCenter.x, y: rawPlacementCenter.y }
      : null;
    const linked = linkOriginalFilesToPage(page, prepared, now, {
      placementCenter,
      placementId: pageTypeDefinition(page.type)?.fileImportPlacementId
    });
    const stageOnly = req.body.stageOnly === true;
    if (!stageOnly) {
      page.updatedAt = now;
      await writeJson(filePath, page);
    }
    let updatedPageIndex;
    if (stageOnly) {
      updatedPageIndex = await readPageIndex();
    } else {
      await updatePageIndex(req.params.pageId, { updatedAt: now });
      updatedPageIndex = await readPageIndex();
    }
    res.json({
      page,
      linked,
      pageIndex: updatedPageIndex
    });
  } catch (error) {
    console.error('[server:add-file:failed]', {
      pageId: req.params.pageId,
      code: error.code || null,
      status: error.status || null,
      error: error.message
    });
    const httpError = linkedResourceHttpError(error);
    if (httpError) return res.status(httpError.status).json({ error: httpError.message });
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
}));

function sameManagedResourceOwner(left, right) {
  if (left.type !== right.type) return false;
  if (left.type === 'folder') return left.folderId === right.folderId;
  if (left.type === 'workspace') return left.workspaceId === right.workspaceId;
  if (left.type === 'vault') {
    return left.relativePath.split('/').slice(0, 2).join('/')
      === right.relativePath.split('/').slice(0, 2).join('/');
  }
  return false;
}

app.patch('/api/pages/:pageId/resources/:itemId/location', transactionalJsonRoute(async (req, res, next) => {
  try {
    if (!desktopMutationAuthorized(
      configuredDesktopMutationToken,
      req.get('x-viewer-desktop-token')
    )) {
      return res.status(403).json({ error: 'Resource relocation is available in the desktop app.' });
    }
    if (!/^[a-z0-9_-]+$/i.test(req.params.pageId)
      || !/^[a-z0-9_-]+$/i.test(req.params.itemId)) {
      return res.status(400).json({ error: 'A valid page and resource ID are required.' });
    }
    const previousLocation = normalizeResourceLocation(req.body?.previousLocation);
    const nextLocation = normalizeResourceLocation(req.body?.nextLocation);
    if (!sameManagedResourceOwner(previousLocation, nextLocation)
      || path.posix.basename(previousLocation.relativePath)
        !== path.posix.basename(nextLocation.relativePath)) {
      return res.status(400).json({ error: 'The relocated resource must remain inside its managed root.' });
    }

    const filePath = await pagePath(req.params.pageId);
    if (!filePath) return res.status(404).json({ error: 'Page not found in page index.' });
    const previousPage = normalizePageShape(await readJson(filePath));
    if (rejectUnsupportedPageForApi(res, previousPage)) return;
    const item = [...(previousPage.objects || []), ...(previousPage.maintenanceResources || [])]
      .find((candidate) => candidate.id === req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Resource not found.' });
    const currentLocation = normalizeResourceLocation(item);
    if (JSON.stringify(currentLocation) === JSON.stringify(nextLocation)) {
      return res.json({ ok: true, changed: false, location: nextLocation, page: previousPage });
    }
    if (JSON.stringify(currentLocation) !== JSON.stringify(previousLocation)) {
      return res.status(409).json({
        error: 'The resource location changed before relocation could be saved.',
        code: 'STALE_RESOURCE_LOCATION'
      });
    }

    const resolved = await requireConfiguredResourceResolver()(nextLocation);
    const stat = await fs.stat(resolved.absolutePath);
    if (!stat.isFile()) {
      return res.status(409).json({ error: 'The relocated file does not match the managed resource.' });
    }

    const updatedAt = new Date().toISOString();
    const nextPage = cloneJson(previousPage);
    const updatedResourceIds = [];
    for (const candidate of [
      ...(nextPage.objects || []),
      ...(nextPage.maintenanceResources || [])
    ]) {
      let candidateLocation;
      try {
        candidateLocation = normalizeResourceLocation(candidate);
      } catch {
        continue;
      }
      if (JSON.stringify(candidateLocation) !== JSON.stringify(previousLocation)) continue;
      Object.assign(candidate, withResourceLocation(candidate, nextLocation), {
        size: Number(stat.size),
        updatedAt
      });
      updatedResourceIds.push(candidate.id);
    }
    nextPage.updatedAt = updatedAt;
    const previousPageIndex = await readPageIndex();
    const nextPageIndex = cloneJson(previousPageIndex);
    applyPageIndexChanges(nextPageIndex, req.params.pageId, { updatedAt });
    await writeJsonTransaction([
      { filePath, previousValue: previousPage, nextValue: nextPage },
      {
        filePath: path.join(DATA_DIR, 'pageIndex.json'),
        previousValue: previousPageIndex,
        nextValue: normalizePageIndexShape(nextPageIndex)
      }
    ]);
    return res.json({
      ok: true,
      changed: true,
      location: nextLocation,
      previousLocation,
      updatedResourceIds,
      page: nextPage
    });
  } catch (error) {
    const httpError = linkedResourceHttpError(error);
    if (httpError) return res.status(httpError.status).json({ error: httpError.message });
    next(error);
  }
}));

app.get('/api/pages/:pageId/resources/:itemId/content', async (req, res, next) => {
  try {
    if (!/^[a-z0-9_-]+$/i.test(req.params.pageId)
      || !/^[a-z0-9_-]+$/i.test(req.params.itemId)) {
      return res.status(400).json({ error: 'A valid page and resource ID are required.' });
    }
    const filePath = await pagePath(req.params.pageId);
    if (!filePath) return res.status(404).json({ error: 'Page not found in page index.' });
    const page = normalizePageShape(await readJson(filePath));
    if (rejectUnsupportedPageForApi(res, page)) return;
    const contentService = createLinkedResourceService({
      resolveLocation: requireConfiguredResourceResolver(),
      fsImpl: fs
    });
    const content = await contentService.prepareContent(page, req.params.itemId);
    res.set(resourceContentHeaders(content));
    if (resourceContentIsFresh(req.headers, content)) {
      return res.status(304).end();
    }
    return res.sendFile(content.absolutePath, (error) => {
      if (error) next(error);
    });
  } catch (error) {
    const httpError = linkedResourceHttpError(error);
    if (httpError) return res.status(httpError.status).json({ error: httpError.message });
    next(error);
  }
});

app.get('/api/display-proxies/:fingerprint/:tier', async (req, res, next) => {
  try {
    if (!configuredDisplayProxyService) return res.status(404).end();
    const content = await configuredDisplayProxyService.prepareContent(
      req.params.fingerprint,
      req.params.tier
    );
    res.set({
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Type': content.mimeType,
      'Content-Length': String(content.size)
    });
    return res.sendFile(content.absolutePath, (error) => {
      if (error) next(error);
    });
  } catch (error) {
    if (['PROXY_NOT_FOUND', 'SOURCE_MISSING', 'SOURCE_CHANGED'].includes(error.code)) {
      return res.status(404).end();
    }
    next(error);
  }
});

app.post('/api/pages/:pageId/objects/:objectId/visibility', transactionalJsonRoute(async (req, res, next) => {
  try {
    if (!/^[a-z0-9_-]+$/i.test(req.params.pageId)
      || !/^[a-z0-9_-]+$/i.test(req.params.objectId)) {
      return res.status(400).json({ error: 'A valid page and object ID are required.' });
    }
    if (typeof req.body.visible !== 'boolean') {
      return res.status(400).json({ error: 'A boolean visible value is required.' });
    }

    const filePath = await pagePath(req.params.pageId);
    if (!filePath) return res.status(404).json({ error: 'Page not found in page index.' });

    const page = normalizePageShape(await readJson(filePath));
    if (rejectUnsupportedPageForApi(res, page)) return;
    const object = page.objects.find((item) => item.id === req.params.objectId);
    if (!object || object.displayable === false) {
      return res.status(404).json({ error: 'Displayable object was not found.' });
    }

    object.visible = req.body.visible;
    const updatedAt = new Date().toISOString();
    repairImportedOriginalNames(page);
    await repairImportedImageDisplaySizes(page);
    page.updatedAt = updatedAt;
    await writeJson(filePath, page);
    await updatePageIndex(req.params.pageId, { updatedAt });

    res.json({
      page,
      pageIndex: await readPageIndex()
    });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Page not found.' });
    next(error);
  }
}));

app.delete('/api/pages/:pageId/resources/:itemId', transactionalJsonRoute(async (req, res, next) => {
  try {
    if (!/^[a-z0-9_-]+$/i.test(req.params.pageId)
      || !/^[a-z0-9_-]+$/i.test(req.params.itemId)) {
      return res.status(400).json({ error: 'A valid page and resource ID are required.' });
    }

    const filePath = await pagePath(req.params.pageId);
    if (!filePath) return res.status(404).json({ error: 'Page not found in page index.' });

    const page = normalizePageShape(await readJson(filePath));
    if (rejectUnsupportedPageForApi(res, page)) return;
    const previousPage = cloneJson(page);
    const unlink = unlinkPageResource(page, req.params.itemId);
    if (!unlink) return res.status(404).json({ error: 'Resource not found.' });
    const { unlinkedKind, removedBlockCount } = unlink;

    const updatedAt = new Date().toISOString();
    page.updatedAt = updatedAt;
    await writeJson(filePath, page);
    if (removedBlockCount) await syncBacklinksForPageLinks(previousPage, page, updatedAt);
    const workingPageIndex = await readPageIndex();
    applyPageIndexChanges(workingPageIndex, req.params.pageId, { updatedAt });
    const descriptorSync = removedBlockCount
      ? await runDescriptorSync([
        page.id,
        ...relatedPageIds(previousPage),
        ...relatedPageIds(page)
      ], {
        workingPageIndex,
        directChangedPageIds: [page.id],
        changedDomains: ['pages', 'relations']
      })
      : null;
    if (!removedBlockCount) await writePageIndex(workingPageIndex);
    const pageIndex = removedBlockCount ? await readPageIndex() : workingPageIndex;

    res.json({
      page,
      pageIndex,
      navigation: await readNavigation(),
      deletedItemId: req.params.itemId,
      deletedKind: unlinkedKind,
      removedBlockCount,
      descriptorSync,
      metadataChangeSet: descriptorSync?.metadataChangeSet || null
    });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Page not found.' });
    next(error);
  }
}));

app.delete('/api/pages/:pageId', transactionalJsonRoute(async (req, res, next) => {
  try {
    if (!/^[a-z0-9_-]+$/i.test(req.params.pageId)) {
      return res.status(400).json({ error: 'A valid page ID is required.' });
    }

    let pageIndex = await readPageIndex();
    const navigation = await readNavigation();
    const project = await readProjectFacade();
    const entry = (pageIndex.pages || []).find((page) => page.id === req.params.pageId);
    const pageInNavigation = navigationReferencesPage(navigation, req.params.pageId);
    if (req.query.path && entry && req.query.path !== entry.path) {
      return res.status(404).json({ error: 'Page not found in page index.' });
    }

    const pagePathResult = await findPageJsonPath(req.params.pageId, pageIndex);
    const filePath = pagePathResult.filePath;
    const warnings = [...pagePathResult.warnings];
    if (!entry && !filePath && !pageInNavigation) {
      return res.status(404).json({ error: 'Page not found.' });
    }
    if (req.query.path && filePath && req.query.path !== relativeDataPath(filePath)) {
      return res.status(404).json({ error: 'Page path does not match.' });
    }
    if (!filePath) warnings.push(`Page JSON file was not found for ${req.params.pageId}.`);

    let deletedPage = filePath ? await readJson(filePath) : { id: req.params.pageId };
    if (filePath && !Array.isArray(deletedPage.backlinks)) {
      await repairBacklinks();
      pageIndex = await readPageIndex();
      deletedPage = await readJson(filePath);
    }
    normalizePageShape(deletedPage);
    if (rejectUnsupportedPageForApi(res, deletedPage)) return;
    if (deletedPage.id !== req.params.pageId) {
      warnings.push(`Deleted page JSON id ${deletedPage.id} did not match requested id ${req.params.pageId}; using requested id for cleanup.`);
      deletedPage.id = req.params.pageId;
    }
    const pageDestructionSource = cloneJson(deletedPage);
    const descriptorSyncStartPageIds = [...new Set([
      ...relatedPageIds(pageDestructionSource)
    ])];

    const updatedAt = new Date().toISOString();
    const pageIndexAfterDelete = {
      ...pageIndex,
      pages: (pageIndex.pages || []).filter((page) => page.id !== deletedPage.id)
    };
    // Binding cleanup must see the pre-delete Page registry so a Leader's
    // canonical root/manual placement can release surviving Followers before
    // missing-member normalization would dissolve the group.
    const bindingCleanup = cleanupBindingForDeletedPage(
      navigation,
      pageIndex,
      deletedPage.id
    );
    if (bindingCleanup.error) {
      return res.status(400).json({ error: bindingCleanup.error });
    }
    const navigationAfterDelete = {
      ...bindingCleanup.navigation,
      items: (bindingCleanup.navigation.items || []).filter((item) => (
        typeof item !== 'string' || item !== deletedPage.id
      ))
    };
    removePageFromManualFolders(navigationAfterDelete.folders, deletedPage.id);
    const normalizedNavigationAfterDelete = normalizeNavigation(navigationAfterDelete, pageIndexAfterDelete);
    const fallbackPageId = fallbackPageIdAfterDelete(
      deletedPage.id,
      pageIndexAfterDelete,
      normalizedNavigationAfterDelete
    );

    const pageResourceUnlinks = unlinkAllPageResources(deletedPage);
    await cleanupPagesAfterDelete(pageDestructionSource, pageIndexAfterDelete, updatedAt);
    const deletedAssets = await deletePageDestructionObjectFiles(
      pageResourceUnlinks.objectUnlinks,
      pageIndexAfterDelete,
      deletedPage.id
    );
    let pageJsonDeleted = false;
    if (filePath) {
      await deleteJson(filePath);
      pageJsonDeleted = true;
    }

    if (project.lastOpenedPageId === deletedPage.id) {
      project.lastOpenedPageId = fallbackPageId || null;
    }

    const descriptorSync = await runDescriptorSync(descriptorSyncStartPageIds, {
      workingPageIndex: pageIndexAfterDelete,
      directChangedPageIds: [deletedPage.id],
      changedDomains: ['pages', 'relations']
    });
    const savedNavigationAfterDelete = NavigationProjection.updatePages({
      navigation: normalizedNavigationAfterDelete,
      previousPageIndex: pageIndex,
      pageIndex: descriptorSync.pageIndex,
      changes: [{
        id: deletedPage.id,
        before: pageDestructionSource,
        after: null,
        membershipChanged: true,
        presentationChanged: true
      }]
    }).navigation;
    await writeJson(NAVIGATION_PATH, savedNavigationAfterDelete);
    await writeProjectFacade(project);
    await removePageViewStateFromVaultWorkspaceState(VAULT_ROOT, deletedPage.id);

    res.json({
      deletedPageId: deletedPage.id,
      pageJsonDeleted,
      pageJsonPath: filePath ? relativeDataPath(filePath) : null,
      warnings,
      deletedAssets,
      resourceUnlinks: {
        objects: pageResourceUnlinks.objectUnlinks.length,
        maintenanceResources: pageResourceUnlinks.maintenanceUnlinks.length,
        blocks: pageResourceUnlinks.removedBlockCount
      },
      descriptorSync,
      fallbackPageId,
      pageIndex: descriptorSync.pageIndex,
      navigation: savedNavigationAfterDelete,
      project,
      metadataChangeSet: descriptorSync.metadataChangeSet
    });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Page not found.' });
    next(error);
  }
}));

app.use((error, req, res, next) => {
  console.error(`[${req.method} ${req.originalUrl}]`, error);
  res.status(error.status || 500).json({ error: error.status ? error.message : 'Something went wrong.' });
});

async function start(options = {}) {
  if (lifecycleState === 'starting' || activeServer?.listening) {
    throw new Error(`Vault server context ${vaultId} is already running.`);
  }
  if (lifecycleState === 'closing' || lifecycleState === 'closed') {
    throw new Error(`Vault server context ${vaultId} has been closed.`);
  }
  lifecycleState = 'starting';
  startPromise = startContext(options).finally(() => {
    startPromise = null;
  });
  return startPromise;
}

async function startContext({ port = 3000, host } = {}) {
  try {
    await ensureSampleData();
    await readDescriptorGroups();
    await withJsonWriteTransaction(async () => {
      await migrateStructuredTextFrameOwnership();
      await migrateLastOpenedPageOwnership();
      await migrateNavigationProjection();
      await migrateLegacyDescriptorMetadataRevision();
    });
    const [startupPageIndex, startupDescriptorLibrary, startupSyncIndex] = await settledValues([
      readPageIndex(),
      readDescriptorLibrary(),
      readJsonIfExists(DESCRIPTOR_SYNC_INDEX_PATH)
    ]);
    if (!metadataRevisionStatus(
      startupPageIndex,
      startupSyncIndex,
      startupDescriptorLibrary
    ).coherent) {
      console.warn('Descriptor metadata projections require an explicit canonical rebuild.');
    }

    const server = await new Promise((resolve, reject) => {
      const listener = app.listen(port, host);
      const onError = (error) => {
        listener.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        listener.off('error', onError);
        resolve(listener);
      };
      listener.once('error', onError);
      listener.once('listening', onListening);
    });
    activeServer = server;
    lifecycleState = 'running';
    server.once('close', () => {
      if (activeServer === server) activeServer = null;
      lifecycleState = 'closed';
    });
    Object.defineProperty(server, 'vaultServerContext', {
      configurable: false,
      enumerable: false,
      value: context,
      writable: false
    });
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`Reductionism & Emergence is running at http://${host || 'localhost'}:${actualPort}`);
    return server;
  } catch (error) {
    lifecycleState = 'idle';
    throw error;
  }
}

async function close() {
  if (closePromise) return closePromise;
  lifecycleState = 'closing';
  closePromise = (async () => {
    if (startPromise) await startPromise.catch(() => {});
    const server = activeServer;
    let closeError = null;
    if (server?.listening) {
      try {
        await new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      } catch (error) {
        closeError = error;
      }
    }
    await Promise.all([
      pageMutationQueue.catch(() => {}),
      vaultPreferenceMutationQueue.catch(() => {})
    ]);
    pageMutationQueue = Promise.resolve();
    vaultPreferenceMutationQueue = Promise.resolve();
    configuredResourceResolver = null;
    configuredDesktopMutationToken = null;
    configuredDisplayProxyService = null;
    activeServer = null;
    lifecycleState = 'closed';
    if (closeError) throw closeError;
  })();
  return closePromise;
}

const context = Object.freeze({
  app,
  appRoot: APP_ROOT,
  close,
  get server() {
    return activeServer;
  },
  start,
  vaultId,
  vaultRoot: VAULT_ROOT
});

return context;
}

async function compatibilityVaultId(vaultRoot, requestedVaultId) {
  if (typeof requestedVaultId === 'string' && requestedVaultId.trim()) return requestedVaultId;
  const metadata = await readJsonIfExists(path.join(vaultRoot, 'vault.json'));
  const metadataId = metadata?.vaultId || metadata?.projectId;
  return typeof metadataId === 'string' && metadataId.trim()
    ? metadataId
    : path.basename(vaultRoot);
}

// Standalone development and older integration callers use this thin adapter.
// Environment variables are resolved once here, before the explicit context is
// constructed; request handling never consults ambient process state.
async function startServer(options = {}) {
  const {
    port = process.env.PORT || 3000,
    host,
    appRoot = process.env.VIEWER_APP_ROOT || path.resolve(__dirname, '..'),
    vaultRoot = process.env.VIEWER_ROOT
      || path.join(applicationDataRoot(), 'vaults', 'vault_default'),
    vaultId: requestedVaultId,
    resourceResolver = null,
    displayProxyService = null,
    desktopMutationToken = null
  } = options;
  const resolvedVaultRoot = path.resolve(vaultRoot);
  const vaultId = await compatibilityVaultId(resolvedVaultRoot, requestedVaultId);
  const context = createVaultServerContext({
    appRoot,
    vaultId,
    vaultRoot: resolvedVaultRoot,
    resourceResolver,
    displayProxyService,
    desktopMutationToken
  });
  return context.start({ port, host });
}

module.exports = {
  createVaultServerContext,
  startServer
};
