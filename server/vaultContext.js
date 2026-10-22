const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { writeJsonAtomic } = require('./jsonStore');
const {
  migratedLastOpenedPageId,
  normalizeVaultWorkspaceState
} = require('./vaultWorkspaceState');
const { DEFAULT_SETTINGS: PAGE_TYPE_DEFAULT_SETTINGS } = require('../public/pageTypes');
const { DEFAULT_SETTINGS: MARKDOWN_DEFAULT_SETTINGS } = require('../public/markdownPage');
const { DEFAULT_SETTINGS: HN_TEXT_DEFAULT_SETTINGS } = require('../public/hnText');
const navigationSort = require('../public/navigationSort');

const APP_DATA_SCHEMA_VERSION = 1;
const VAULT_SCHEMA_VERSION = 1;
const DEFAULT_VAULT_ID = 'vault_default';
const APP_DATA_DIRECTORY_NAME = 'CogNeuro Viewer';

const DEFAULT_VAULT_FILES = Object.freeze({
  'pageIndex.json': { metadataRevision: 0, pages: [] },
  'navigation.json': {
    version: 3,
    folders: [{
      id: 'folder_uncategorised',
      label: 'Uncategory',
      type: 'system',
      pinned: true,
      collapsed: true,
      defaultPageId: null,
      pinnedPageIds: [],
      pageOrder: [],
      source: { kind: 'missingCategories' }
    }],
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
    groups: []
  },
  'descriptors.json': {
    version: 1,
    metadataRevision: 0,
    classes: [],
    groups: [{ id: 'ungrouped', label: 'Ungrouped', children: [] }],
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
  'descriptorSyncRules.json': { rules: [] },
  'vocabulary.json': { version: 1, entries: [] },
  'linkTypes.json': {
    linkTypes: [
      { id: 'contains', label: 'contain', opposite: 'contained_by' },
      { id: 'contained_by', label: 'contained by', opposite: 'contains' }
    ],
    defaultLinkTypeId: 'contains'
  },
  'appearance.json': null,
  'workspaceState.json': normalizeVaultWorkspaceState(null)
});

const REQUIRED_VAULT_FILES = Object.freeze([
  'vault.json',
  'pageIndex.json',
  'navigation.json',
  'categories.json',
  'descriptors.json',
  'vocabulary.json',
  'linkTypes.json',
  'workspaceState.json'
]);

function applicationDataRoot({
  env = process.env,
  homeDirectory = os.homedir(),
  platform = process.platform
} = {}) {
  if (env.VIEWER_APP_DATA_ROOT) return path.resolve(env.VIEWER_APP_DATA_ROOT);
  if (platform === 'darwin') {
    return path.join(homeDirectory, 'Library', 'Application Support', APP_DATA_DIRECTORY_NAME);
  }
  return path.join(homeDirectory, '.config', APP_DATA_DIRECTORY_NAME);
}

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative));
}

function resolveVaultPath(vault, ...segments) {
  const suppliedRoot = typeof vault === 'string' ? vault : vault?.root || vault?.vaultRoot;
  if (typeof suppliedRoot !== 'string' || !suppliedRoot.trim()) {
    throw new TypeError('A current Vault root is required.');
  }
  const root = path.resolve(suppliedRoot);
  const resolved = path.resolve(root, ...segments);
  if (!isPathInside(root, resolved)) throw new Error('The resolved path leaves the current Vault.');
  return resolved;
}

function resolveVaultPagePath(vault, pageId) {
  if (!/^[a-z0-9_-]+$/i.test(pageId || '')) throw new TypeError('A stable Page ID is required.');
  return resolveVaultPath(vault, 'pages', `${pageId}.json`);
}

function resolveVaultManagedAssetPath(vault, kind, ...segments) {
  if (!['images', 'resources'].includes(kind)) throw new TypeError('Unknown managed asset kind.');
  return resolveVaultPath(vault, 'assets', kind, ...segments);
}

async function readJson(filePath, { fsImpl = fs } = {}) {
  return JSON.parse(await fsImpl.readFile(filePath, 'utf8'));
}

async function writeJsonFileAtomic(filePath, value, { fsImpl = fs } = {}) {
  if (fsImpl === fs) return writeJsonAtomic(filePath, value);
  await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsImpl.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fsImpl.rename(temporaryPath, filePath);
  } catch (error) {
    await fsImpl.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function pathExists(filePath, { fsImpl = fs } = {}) {
  try {
    await fsImpl.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function stableVaultId(project) {
  const candidate = typeof project?.projectId === 'string' ? project.projectId.trim() : '';
  return /^[a-z0-9_-]+$/i.test(candidate) ? candidate : DEFAULT_VAULT_ID;
}

function vaultMetadata({ vaultId, displayName, now, sourceVersion = null }) {
  return {
    vaultId,
    displayName: displayName || 'Default Vault',
    schemaVersion: VAULT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    ...(sourceVersion ? { sourceVersion } : {}),
    defaultManagedResourceLocation: {
      type: 'vault',
      imageRoot: 'assets/images',
      resourceRoot: 'assets/resources'
    },
    ...PAGE_TYPE_DEFAULT_SETTINGS,
    ...MARKDOWN_DEFAULT_SETTINGS,
    ...HN_TEXT_DEFAULT_SETTINGS
  };
}

async function copyFile(source, destination, report, options) {
  const { fsImpl = fs } = options;
  await fsImpl.mkdir(path.dirname(destination), { recursive: true });
  await fsImpl.copyFile(source, destination);
  report.filesCopied.push({ source, destination });
}

async function copyDirectory(source, destination, report, options) {
  const { fsImpl = fs } = options;
  if (!(await pathExists(source, options))) return;
  await fsImpl.mkdir(destination, { recursive: true });
  const entries = await fsImpl.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyDirectory(sourcePath, destinationPath, report, options);
    else if (entry.isFile()) await copyFile(sourcePath, destinationPath, report, options);
    else report.skippedApplicationAssets.push(sourcePath);
  }
}

function navigationPageReferences(navigation) {
  const references = new Set();
  const visit = (value, key = '') => {
    if (typeof value === 'string') {
      if (key === 'defaultPageId' || key === 'pageId' || key === 'pageOrder'
        || key === 'pinnedPageIds' || key === 'items') references.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey);
  };
  // Binding membership and projector-owned dynamic membership are
  // intentionally omitted here. They are not canonical Page references for
  // Vault preflight: Binding repair stays in navigationModel, while legacy or
  // corrupt projection state is handled by the one-time migration or the
  // explicit Rebuild Navigation command, never by an ordinary read.
  visit(navigation);
  return references;
}

function managedLocations(page, result = []) {
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value) && value.type === 'vault' && typeof value.relativePath === 'string') {
      result.push(value.relativePath.replace(/\\/g, '/'));
    }
    if (!Array.isArray(value) && typeof value.src === 'string'
      && value.src.replace(/\\/g, '/').startsWith('assets/')) {
      result.push(value.src.replace(/\\/g, '/'));
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child);
  };
  visit(page);
  return result;
}

async function validateVault(vaultRoot, {
  fsImpl = fs,
  expectedPageCount = null,
  legacyPageIdSet = null
} = {}) {
  const errors = [];
  const unresolvedReferences = [];
  for (const relativePath of REQUIRED_VAULT_FILES) {
    if (!(await pathExists(path.join(vaultRoot, relativePath), { fsImpl }))) {
      errors.push(`Missing ${relativePath}.`);
    }
  }
  for (const relativePath of ['pages', 'assets/images', 'assets/resources']) {
    try {
      if (!(await fsImpl.stat(path.join(vaultRoot, relativePath))).isDirectory()) {
        errors.push(`${relativePath} is not a directory.`);
      }
    } catch {
      errors.push(`Missing ${relativePath}.`);
    }
  }
  if (errors.length) return { valid: false, errors, unresolvedReferences, pageCount: 0 };

  let metadata;
  let pageIndex;
  let navigation;
  try {
    [metadata, pageIndex, navigation] = await Promise.all([
      readJson(path.join(vaultRoot, 'vault.json'), { fsImpl }),
      readJson(path.join(vaultRoot, 'pageIndex.json'), { fsImpl }),
      readJson(path.join(vaultRoot, 'navigation.json'), { fsImpl })
    ]);
    await Promise.all([
      'categories.json',
      'descriptors.json',
      'vocabulary.json',
      'linkTypes.json',
      'workspaceState.json'
    ]
      .map((name) => readJson(path.join(vaultRoot, name), { fsImpl })));
  } catch (error) {
    errors.push(`Vault JSON is unreadable: ${error.message}`);
    return { valid: false, errors, unresolvedReferences, pageCount: 0 };
  }
  if (!/^[a-z0-9_-]+$/i.test(metadata?.vaultId || '') || !metadata?.displayName) {
    errors.push('vault.json does not contain valid Vault metadata.');
  }
  if (!Array.isArray(pageIndex?.pages)) errors.push('pageIndex.json is invalid.');
  if (!Array.isArray(navigation?.items) || !Array.isArray(navigation?.folders)) {
    errors.push('navigation.json is invalid.');
  }
  const pages = Array.isArray(pageIndex?.pages) ? pageIndex.pages : [];
  if (expectedPageCount !== null && pages.length !== expectedPageCount) {
    errors.push(`Page count mismatch: expected ${expectedPageCount}, found ${pages.length}.`);
  }
  const pageIds = new Set();
  for (const entry of pages) {
    if (!entry || typeof entry.id !== 'string' || pageIds.has(entry.id)) {
      errors.push('Page index contains a missing or duplicate Page ID.');
      continue;
    }
    pageIds.add(entry.id);
    if (legacyPageIdSet && !legacyPageIdSet.has(entry.id)) {
      errors.push(`Unexpected Page ID ${entry.id}.`);
    }
    if (typeof entry.path !== 'string') {
      errors.push(`Page ${entry.id} has no path.`);
      continue;
    }
    const pagePath = path.resolve(vaultRoot, entry.path);
    const pagesRoot = path.join(vaultRoot, 'pages');
    if (!isPathInside(pagesRoot, pagePath)) {
      errors.push(`Page ${entry.id} leaves the pages directory.`);
      continue;
    }
    try {
      const page = await readJson(pagePath, { fsImpl });
      if (page.id !== entry.id) errors.push(`Page ${entry.id} JSON has a different ID.`);
      for (const relativePath of managedLocations(page)) {
        const resourcePath = path.resolve(vaultRoot, ...relativePath.split('/'));
        if (!isPathInside(path.join(vaultRoot, 'assets'), resourcePath)
          || !(await pathExists(resourcePath, { fsImpl }))) {
          unresolvedReferences.push({ pageId: entry.id, relativePath });
        }
      }
    } catch (error) {
      errors.push(`Page ${entry.id} could not be loaded: ${error.message}`);
    }
  }
  for (const pageId of navigationPageReferences(navigation)) {
    if (pageId.startsWith('page_') && !pageIds.has(pageId)) {
      unresolvedReferences.push({ navigationPageId: pageId });
    }
  }
  if (unresolvedReferences.length) errors.push('Vault contains unresolved managed references.');
  return {
    valid: errors.length === 0,
    errors,
    unresolvedReferences,
    pageCount: pages.length,
    vaultId: metadata?.vaultId,
    displayName: metadata?.displayName
  };
}

async function createEmptyVault(targetRoot, metadata, options) {
  const { fsImpl = fs } = options;
  await fsImpl.mkdir(path.join(targetRoot, 'pages'), { recursive: true });
  await fsImpl.mkdir(path.join(targetRoot, 'assets', 'images'), { recursive: true });
  await fsImpl.mkdir(path.join(targetRoot, 'assets', 'resources'), { recursive: true });
  await writeJsonFileAtomic(path.join(targetRoot, 'vault.json'), metadata, options);
  for (const [relativePath, value] of Object.entries(DEFAULT_VAULT_FILES)) {
    await writeJsonFileAtomic(path.join(targetRoot, relativePath), value, options);
  }
}

async function legacyProjectAt(legacyRoot, options) {
  if (!legacyRoot) return null;
  try {
    const project = await readJson(path.join(legacyRoot, 'data', 'project.json'), options);
    const pageIndex = await readJson(path.join(legacyRoot, 'data', 'pageIndex.json'), options);
    const navigation = await readJson(path.join(legacyRoot, 'data', 'navigation.json'), options);
    if (!project || !Array.isArray(pageIndex.pages)
      || !Array.isArray(navigation.items) || !Array.isArray(navigation.folders)) return null;
    return { project, pageIndex, navigation };
  } catch {
    return null;
  }
}

async function legacySettingsAt(appDataRoot, options) {
  for (const filename of ['global-settings.json', 'desktop-settings.json']) {
    try {
      return await readJson(path.join(appDataRoot, filename), options);
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
  }
  return null;
}

function globalSettingsFromLegacy(value, vaultId = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { schemaVersion: APP_DATA_SCHEMA_VERSION };
  }
  const {
    lastVaultPath,
    workspaceStatesByVaultId,
    version,
    ...machineSettings
  } = value;
  const validSortModes = new Set(navigationSort.SORT_OPTIONS.map((option) => option.value));
  const rawSortModes = machineSettings.navigationSortModesByVaultId;
  const navigationSortModesByVaultId = rawSortModes
    && typeof rawSortModes === 'object'
    && !Array.isArray(rawSortModes)
    ? { ...rawSortModes }
    : {};
  const canonicalSortMode = navigationSortModesByVaultId[vaultId];
  const legacySortMode = workspaceStatesByVaultId?.[vaultId]?.navigationSortMode;
  if (/^[a-z0-9_-]+$/i.test(vaultId || '')
    && !validSortModes.has(canonicalSortMode)
    && validSortModes.has(legacySortMode)) {
    navigationSortModesByVaultId[vaultId] = legacySortMode;
  }
  if (Object.keys(navigationSortModesByVaultId).length) {
    machineSettings.navigationSortModesByVaultId = navigationSortModesByVaultId;
  }
  return { schemaVersion: APP_DATA_SCHEMA_VERSION, ...machineSettings };
}

async function migrateLegacyVault({ appDataRoot, legacyRoot, legacy, now, options }) {
  const { fsImpl = fs, idFactory = () => crypto.randomUUID() } = options;
  const vaultId = stableVaultId(legacy.project);
  const vaultsRoot = path.join(appDataRoot, 'vaults');
  const finalRoot = path.join(vaultsRoot, vaultId);
  const temporaryRoot = path.join(vaultsRoot, `.${vaultId}.migration`);
  const report = {
    schemaVersion: APP_DATA_SCHEMA_VERSION,
    status: 'in-progress',
    startedAt: now,
    legacyRoot,
    vaultId,
    vaultRoot: finalRoot,
    filesCopied: [],
    rewrittenPaths: [],
    unresolvedReferences: [],
    skippedApplicationAssets: [],
    archives: []
  };
  await fsImpl.mkdir(vaultsRoot, { recursive: true });
  await fsImpl.rm(temporaryRoot, { recursive: true, force: true });
  const metadata = vaultMetadata({
    vaultId,
    displayName: legacy.project.projectName || 'Default Vault',
    now,
    sourceVersion: legacy.project.version || null
  });
  await createEmptyVault(temporaryRoot, metadata, options);

  const legacyDataRoot = path.join(legacyRoot, 'data');
  const dataEntries = await fsImpl.readdir(legacyDataRoot, { withFileTypes: true });
  for (const entry of dataEntries) {
    if (entry.name === 'project.json') continue;
    const sourcePath = path.join(legacyDataRoot, entry.name);
    const destinationPath = path.join(temporaryRoot, entry.name);
    if (entry.isDirectory()) await copyDirectory(sourcePath, destinationPath, report, options);
    else if (entry.isFile()) await copyFile(sourcePath, destinationPath, report, options);
  }
  await copyDirectory(
    path.join(legacyRoot, 'assets', 'images'),
    path.join(temporaryRoot, 'assets', 'images'),
    report,
    options
  );
  await copyDirectory(
    path.join(legacyRoot, 'assets', 'resources'),
    path.join(temporaryRoot, 'assets', 'resources'),
    report,
    options
  );
  const legacySettings = await legacySettingsAt(appDataRoot, options);
  const workspaceState = legacySettings?.workspaceStatesByVaultId?.[legacy.project.projectId] || null;
  const legacyWorkspaceRecord = {
    lastOpenedPageId: legacy.project.lastOpenedPageId,
    workspaceState
  };
  await writeJsonFileAtomic(path.join(temporaryRoot, 'appearance.json'), legacy.project.appearance || null, options);
  await writeJsonFileAtomic(path.join(temporaryRoot, 'workspaceState.json'), normalizeVaultWorkspaceState({
    lastOpenedPageId: migratedLastOpenedPageId(
      legacyWorkspaceRecord,
      new Set(legacy.pageIndex.pages.map((page) => page.id))
    ),
    workspaceState
  }), options);

  const validation = await validateVault(temporaryRoot, {
    ...options,
    expectedPageCount: legacy.pageIndex.pages.length,
    legacyPageIdSet: new Set(legacy.pageIndex.pages.map((page) => page.id))
  });
  report.pageCount = validation.pageCount;
  report.unresolvedReferences = validation.unresolvedReferences;
  if (!validation.valid) {
    report.status = 'failed';
    report.errors = validation.errors;
    await writeJsonFileAtomic(path.join(appDataRoot, 'migration-report.json'), report, options);
    throw new Error(`Legacy Vault migration failed: ${validation.errors.join(' ')}`);
  }
  if (await pathExists(finalRoot, options)) {
    const existingValidation = await validateVault(finalRoot, options);
    if (!existingValidation.valid) throw new Error('The target Default Vault directory already exists and is invalid.');
    await fsImpl.rm(temporaryRoot, { recursive: true, force: true });
  } else {
    await fsImpl.rename(temporaryRoot, finalRoot);
  }
  report.filesCopied = report.filesCopied.map((entry) => ({
    ...entry,
    destination: isPathInside(temporaryRoot, entry.destination)
      ? path.join(finalRoot, path.relative(temporaryRoot, entry.destination))
      : entry.destination
  }));
  report.counts = {
    pages: validation.pageCount,
    filesCopied: report.filesCopied.length,
    images: report.filesCopied.filter((entry) => (
      isPathInside(path.join(finalRoot, 'assets', 'images'), entry.destination)
    )).length,
    resources: report.filesCopied.filter((entry) => (
      isPathInside(path.join(finalRoot, 'assets', 'resources'), entry.destination)
    )).length
  };
  report.status = 'validated';
  report.completedAt = now;
  report.migrationToken = idFactory();
  return { vaultId, vaultRoot: finalRoot, metadata, report, legacySettings };
}

async function archiveLegacyRoots(legacyRoot, report, options) {
  const { fsImpl = fs } = options;
  for (const basename of ['data', 'assets']) {
    const sourcePath = path.join(legacyRoot, basename);
    if (!(await pathExists(sourcePath, options))) continue;
    const backupPath = path.join(legacyRoot, `${basename}.legacy-backup`);
    if (await pathExists(backupPath, options)) {
      report.archives.push({ source: sourcePath, backup: backupPath, status: 'backup-already-exists' });
      continue;
    }
    await fsImpl.rename(sourcePath, backupPath);
    report.archives.push({ source: sourcePath, backup: backupPath, status: 'archived' });
  }
}

async function readRegistry(appDataRoot, options) {
  try {
    return await readJson(path.join(appDataRoot, 'vault-registry.json'), options);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function ensureCurrentVault({
  appDataRoot = applicationDataRoot(),
  legacyRoot = null,
  now = new Date().toISOString(),
  fsImpl = fs,
  idFactory
} = {}) {
  const options = { fsImpl, idFactory };
  const root = path.resolve(appDataRoot);
  await fsImpl.mkdir(path.join(root, 'vaults'), { recursive: true });
  const registry = await readRegistry(root, options);
  if (registry) {
    const entry = (registry.vaults || []).find((vault) => vault.vaultId === registry.currentVaultId);
    if (!entry) throw new Error('The Vault registry has no valid current Vault.');
    const validation = await validateVault(entry.vaultRoot, options);
    if (!validation.valid) throw new Error(`The current Vault is invalid: ${validation.errors.join(' ')}`);
    const updatedEntry = { ...entry, lastOpenedAt: now };
    const nextRegistry = {
      ...registry,
      schemaVersion: APP_DATA_SCHEMA_VERSION,
      vaults: registry.vaults.map((vault) => vault.vaultId === entry.vaultId ? updatedEntry : vault)
    };
    await writeJsonFileAtomic(path.join(root, 'vault-registry.json'), nextRegistry, options);
    return {
      id: entry.vaultId,
      vaultId: entry.vaultId,
      displayName: entry.displayName,
      projectId: entry.vaultId,
      projectName: entry.displayName,
      root: path.resolve(entry.vaultRoot),
      vaultRoot: path.resolve(entry.vaultRoot),
      migrated: false,
      registry: nextRegistry
    };
  }

  const legacy = await legacyProjectAt(legacyRoot, options);
  let result;
  if (legacy) {
    result = await migrateLegacyVault({ appDataRoot: root, legacyRoot: path.resolve(legacyRoot), legacy, now, options });
  } else {
    const vaultId = DEFAULT_VAULT_ID;
    const vaultRoot = path.join(root, 'vaults', vaultId);
    const metadata = vaultMetadata({ vaultId, displayName: 'Default Vault', now });
    if (!(await pathExists(vaultRoot, options))) await createEmptyVault(vaultRoot, metadata, options);
    const validation = await validateVault(vaultRoot, options);
    if (!validation.valid) throw new Error(`Default Vault creation failed: ${validation.errors.join(' ')}`);
    result = {
      vaultId,
      vaultRoot,
      metadata,
      report: {
        schemaVersion: APP_DATA_SCHEMA_VERSION,
        status: 'created-empty',
        startedAt: now,
        completedAt: now,
        legacyRoot: null,
        vaultId,
        vaultRoot,
        filesCopied: [],
        rewrittenPaths: [],
        unresolvedReferences: [],
        skippedApplicationAssets: [],
        archives: [],
        pageCount: 0
      },
      legacySettings: await legacySettingsAt(root, options)
    };
  }

  const entry = {
    vaultId: result.vaultId,
    displayName: result.metadata.displayName,
    vaultRoot: result.vaultRoot,
    createdAt: result.metadata.createdAt,
    lastOpenedAt: now
  };
  const nextRegistry = {
    schemaVersion: APP_DATA_SCHEMA_VERSION,
    currentVaultId: result.vaultId,
    vaults: [entry]
  };
  await writeJsonFileAtomic(
    path.join(root, 'global-settings.json'),
    globalSettingsFromLegacy(result.legacySettings, result.vaultId),
    options
  );
  await writeJsonFileAtomic(path.join(root, 'vault-registry.json'), nextRegistry, options);
  if (legacy) await archiveLegacyRoots(path.resolve(legacyRoot), result.report, options);
  result.report.status = result.report.status === 'created-empty' ? 'created-empty' : 'complete';
  await writeJsonFileAtomic(path.join(root, 'migration-report.json'), result.report, options);
  return {
    id: result.vaultId,
    vaultId: result.vaultId,
    displayName: result.metadata.displayName,
    projectId: result.vaultId,
    projectName: result.metadata.displayName,
    root: result.vaultRoot,
    vaultRoot: result.vaultRoot,
    migrated: Boolean(legacy),
    registry: nextRegistry,
    migrationReport: result.report
  };
}

module.exports = {
  APP_DATA_DIRECTORY_NAME,
  APP_DATA_SCHEMA_VERSION,
  DEFAULT_VAULT_FILES,
  DEFAULT_VAULT_ID,
  REQUIRED_VAULT_FILES,
  VAULT_SCHEMA_VERSION,
  applicationDataRoot,
  createEmptyVault,
  ensureCurrentVault,
  isPathInside,
  pathExists,
  readJson,
  readRegistry,
  resolveVaultManagedAssetPath,
  resolveVaultPagePath,
  resolveVaultPath,
  validateVault,
  vaultMetadata,
  writeJsonFileAtomic
};
