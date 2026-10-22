const nodeFs = require('fs');
const fs = require('fs/promises');
const path = require('path');
const { cloneJson, readJson } = require('../server/jsonStore');
const { createPageStore } = require('../server/pageStore');
const { folderRegistryView } = require('./folderService');
const {
  normalizeFolderRegistry,
  withRegisteredFolder,
  withoutRegisteredFolder
} = require('./folderRegistry');
const { removeFolderRoot, setFolderRoot } = require('./desktopSettings');
const { isPathInside, resolveWorkspaceResourcePath } = require('./vaultPaths');

class FolderMaintenanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FolderMaintenanceError';
    this.code = code;
  }
}

function pageResourceCollections(page) {
  return [
    ['objects', Array.isArray(page?.objects) ? page.objects : []],
    ['maintenanceResources', Array.isArray(page?.maintenanceResources) ? page.maintenanceResources : []]
  ];
}

function collectFolderReferences(pageRecords, folderId) {
  const sources = new Map();
  let resourceRecordCount = 0;
  const pageIds = new Set();
  for (const record of pageRecords) {
    for (const [collection, items] of pageResourceCollections(record.page)) {
      for (const item of items) {
        const location = item?.location;
        if (location?.type !== 'folder' || location.folderId !== folderId
          || typeof location.relativePath !== 'string' || !location.relativePath) continue;
        const relativePath = location.relativePath.replace(/\\/g, '/');
        let source = sources.get(relativePath);
        if (!source) {
          source = {
            relativePath,
            filename: path.posix.basename(relativePath),
            occurrences: []
          };
          sources.set(relativePath, source);
        }
        source.occurrences.push({
          pageId: record.page.id,
          collection,
          itemId: item.id
        });
        resourceRecordCount += 1;
        pageIds.add(record.page.id);
      }
    }
  }
  return {
    sources: [...sources.values()],
    uniqueFileCount: sources.size,
    resourceRecordCount,
    pageCount: pageIds.size
  };
}

async function loadVaultPageRecords(vaultRoot, { fsImpl = fs } = {}) {
  const dataDir = path.resolve(vaultRoot);
  const pagesDir = path.join(dataDir, 'pages');
  const pageIndexPath = path.join(dataDir, 'pageIndex.json');
  const pageIndex = await readJson(pageIndexPath);
  const pageStore = createPageStore({ dataDir, pagesDir });
  const records = [];
  const seenPaths = new Set();
  for (const entry of pageIndex.pages || []) {
    const filePath = pageStore.safePageFilePath(entry);
    if (!filePath || seenPaths.has(filePath)) continue;
    const page = await readJson(filePath);
    if (!page?.id) continue;
    seenPaths.add(filePath);
    records.push({ filePath, page });
  }
  return { pageIndex, pageIndexPath, records, fsImpl };
}

async function recursiveFilenameIndex(root, filenames, { fsImpl = fs } = {}) {
  const index = new Map([...filenames].map((filename) => [filename, []]));
  if (!index.size) return index;
  const realRoot = await fsImpl.realpath(root);
  const visited = new Set();

  async function walk(directory) {
    let realDirectory;
    try {
      realDirectory = await fsImpl.realpath(directory);
    } catch {
      return;
    }
    if (!isPathInside(realRoot, realDirectory) || visited.has(realDirectory)) return;
    visited.add(realDirectory);
    const entries = await fsImpl.readdir(realDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(realDirectory, entry.name);
      if (entry.isDirectory()) {
        await walk(candidate);
        continue;
      }
      let realPath;
      let stat;
      try {
        realPath = await fsImpl.realpath(candidate);
        stat = await fsImpl.stat(realPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        await walk(realPath);
      } else if (stat.isFile() && isPathInside(realRoot, realPath) && index.has(entry.name)) {
        const matches = index.get(entry.name);
        if (!matches.some((match) => match.realPath === realPath)) {
          matches.push({
            realPath,
            relativePath: path.relative(realRoot, realPath).split(path.sep).join('/')
          });
        }
      }
    }
  }

  await walk(realRoot);
  return index;
}

async function matchCandidateFolder(candidateRoot, references, { fsImpl = fs } = {}) {
  const results = [];
  const fallbackSources = [];
  for (const source of references.sources) {
    try {
      const resolved = await resolveWorkspaceResourcePath(candidateRoot, source.relativePath, { fsImpl });
      results.push({ ...source, status: 'exact', matchedRelativePath: resolved.relativePath });
    } catch {
      fallbackSources.push(source);
    }
  }

  const filenameIndex = await recursiveFilenameIndex(
    candidateRoot,
    new Set(fallbackSources.map((source) => source.filename)),
    { fsImpl }
  );
  for (const source of fallbackSources) {
    const matches = filenameIndex.get(source.filename) || [];
    if (matches.length === 1) {
      results.push({
        ...source,
        status: 'filename',
        matchedRelativePath: matches[0].relativePath
      });
    } else if (matches.length > 1) {
      results.push({ ...source, status: 'ambiguous', matchedRelativePath: null });
    } else {
      results.push({ ...source, status: 'missing', matchedRelativePath: null });
    }
  }

  const counts = { exact: 0, filename: 0, missing: 0, ambiguous: 0 };
  for (const result of results) counts[result.status] += 1;
  return {
    results,
    counts,
    total: references.uniqueFileCount,
    matched: counts.exact + counts.filename,
    allMatched: counts.missing === 0 && counts.ambiguous === 0
  };
}

function changeWarningText(match) {
  if (match.matched === 0) {
    return {
      message: 'This folder does not appear to be the original folder.',
      detail: `None of the ${match.total} referenced files were found. Changing anyway will make the existing resources unavailable.`
    };
  }
  const lines = [`${match.matched} of ${match.total} referenced files were found.`];
  if (match.counts.missing) {
    lines.push(`${match.counts.missing} ${match.counts.missing === 1 ? 'file was' : 'files were'} not found.`);
  }
  if (match.counts.ambiguous) {
    lines.push(`${match.counts.ambiguous} ${match.counts.ambiguous === 1 ? 'filename was' : 'filenames were'} ambiguous.`);
  }
  lines.push('Changing anyway may leave some resources unavailable.');
  return { message: 'This folder may not be the original folder.', detail: lines.join('\n') };
}

function updatedPageBatch(vaultPages, folderId, locationUpdates, { now = () => new Date() } = {}) {
  const changes = [];
  const pageIndex = cloneJson(vaultPages.pageIndex);
  const timestamp = now().toISOString();
  for (const record of vaultPages.records) {
    const page = cloneJson(record.page);
    let changed = false;
    for (const [, items] of pageResourceCollections(page)) {
      for (const item of items) {
        const location = item?.location;
        if (location?.type !== 'folder' || location.folderId !== folderId) continue;
        const lookupPath = typeof location.relativePath === 'string'
          ? location.relativePath.replace(/\\/g, '/')
          : '';
        const update = locationUpdates.get(lookupPath);
        if (!update) continue;
        item.location = {
          ...location,
          folderId: update.folderId || folderId,
          relativePath: update.relativePath
        };
        changed = true;
      }
    }
    if (!changed) continue;
    page.updatedAt = timestamp;
    const indexEntry = (pageIndex.pages || []).find((entry) => entry.id === page.id);
    if (indexEntry) indexEntry.updatedAt = timestamp;
    changes.push({ filePath: record.filePath, value: page });
  }
  if (changes.length) changes.push({ filePath: vaultPages.pageIndexPath, value: pageIndex });
  return changes;
}

async function beginJsonBatchTransaction(changes, { fsImpl = fs } = {}) {
  if (!changes.length) return { finalize: async () => {}, rollback: async () => {} };
  const stamp = `${process.pid}.${Date.now()}`;
  const prepared = [];
  try {
    for (let index = 0; index < changes.length; index += 1) {
      const change = changes[index];
      const temporaryPath = `${change.filePath}.${stamp}.${index}.tmp`;
      const backupPath = `${change.filePath}.${stamp}.${index}.bak`;
      await fsImpl.writeFile(temporaryPath, `${JSON.stringify(change.value, null, 2)}\n`, 'utf8');
      prepared.push({ ...change, temporaryPath, backupPath, committed: false });
    }
    for (const item of prepared) {
      await fsImpl.rename(item.filePath, item.backupPath);
      try {
        await fsImpl.rename(item.temporaryPath, item.filePath);
        item.committed = true;
      } catch (error) {
        await fsImpl.rename(item.backupPath, item.filePath).catch(() => {});
        throw error;
      }
    }
  } catch (error) {
    for (const item of [...prepared].reverse()) {
      if (item.committed) {
        await fsImpl.rm(item.filePath, { force: true }).catch(() => {});
        await fsImpl.rename(item.backupPath, item.filePath).catch(() => {});
      }
      await fsImpl.rm(item.temporaryPath, { force: true }).catch(() => {});
      await fsImpl.rm(item.backupPath, { force: true }).catch(() => {});
    }
    throw error;
  }

  let settled = false;
  return {
    async finalize() {
      if (settled) return;
      settled = true;
      await Promise.all(prepared.map((item) => (
        fsImpl.rm(item.backupPath, { force: true }).catch(() => {})
      )));
    },
    async rollback() {
      if (settled) return;
      for (const item of [...prepared].reverse()) {
        await fsImpl.rm(item.filePath, { force: true });
        await fsImpl.rename(item.backupPath, item.filePath);
      }
      settled = true;
    }
  };
}

async function planCollisionSafeCopies(sources, destinationRoot, { fsImpl = fs } = {}) {
  const reserved = new Set();
  const plans = [];
  for (const source of sources) {
    const originalName = path.basename(source.absolutePath).replace(/[\0-\x1f\x7f]/g, '').trim() || 'file';
    const parsed = path.parse(originalName);
    let planned = null;
    for (let number = 0; number < 1000; number += 1) {
      const filename = number ? `${parsed.name}_${number}${parsed.ext}` : originalName;
      const destination = path.join(destinationRoot, filename);
      if (reserved.has(destination)) continue;
      try {
        const [sourceStat, destinationStat] = await Promise.all([
          fsImpl.stat(source.absolutePath),
          fsImpl.stat(destination)
        ]);
        if (!destinationStat.isFile() || sourceStat.size !== destinationStat.size) continue;
        const [sourceContent, destinationContent] = await Promise.all([
          fsImpl.readFile(source.absolutePath),
          fsImpl.readFile(destination)
        ]);
        if (!sourceContent.equals(destinationContent)) continue;
        planned = { ...source, destination, filename, create: false };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        planned = { ...source, destination, filename, create: true };
      }
      if (planned) break;
    }
    if (!planned) throw new FolderMaintenanceError('COPY_COLLISION', `Could not plan a safe copy for ${originalName}.`);
    reserved.add(planned.destination);
    plans.push(planned);
  }
  return plans;
}

async function executeCopyPlans(plans, { fsImpl = fs } = {}) {
  const created = [];
  try {
    for (const plan of plans) {
      if (!plan.create) continue;
      await fsImpl.copyFile(plan.absolutePath, plan.destination, nodeFs.constants.COPYFILE_EXCL);
      created.push(plan.destination);
    }
    return created;
  } catch (error) {
    await Promise.all(created.map((filePath) => fsImpl.rm(filePath, { force: true }).catch(() => {})));
    throw error;
  }
}

function createFolderMaintenanceService({
  vaultId,
  vaultRoot,
  loadRegistry,
  saveRegistry,
  loadSettings,
  saveSettings,
  selectFolder,
  confirmChange,
  confirmMigration,
  fsImpl = fs,
  now = () => new Date()
}) {
  async function inventory(folderId) {
    const vaultPages = await loadVaultPageRecords(vaultRoot, { fsImpl });
    return { vaultPages, references: collectFolderReferences(vaultPages.records, folderId) };
  }

  async function commitRegistryAndSettings({ registry, settings, nextRegistry, nextSettings, pageTransaction }) {
    let settingsSaved = false;
    try {
      await saveSettings(nextSettings);
      settingsSaved = true;
      await saveRegistry(nextRegistry);
      await pageTransaction.finalize();
    } catch (error) {
      if (settingsSaved) await saveSettings(settings).catch(() => {});
      await saveRegistry(registry).catch(() => {});
      await pageTransaction.rollback().catch(() => {});
      throw error;
    }
  }

  async function changeReadOnlyFolder(folderId) {
    const registry = normalizeFolderRegistry(await loadRegistry());
    const target = registry.folders.find((folder) => folder.id === folderId);
    if (!target || registry.defaultFolderId === folderId) {
      throw new FolderMaintenanceError('NOT_READ_ONLY', 'A read-only folder is required.');
    }
    const selected = await selectFolder();
    if (!selected) return { ok: false, cancelled: true };
    const { canonicalFolderRoot } = require('./folderService');
    const candidateRoot = await canonicalFolderRoot(selected, { fsImpl });
    const settings = await loadSettings();
    const view = await folderRegistryView(registry, settings, vaultId, { fsImpl });
    const duplicate = view.folders.find((folder) => folder.realRoot === candidateRoot);
    if (duplicate?.id === folderId) return { ok: true, changed: false };
    if (duplicate) {
      throw new FolderMaintenanceError('DUPLICATE_FOLDER', 'This folder is already linked.');
    }

    let vaultPages;
    let references;
    let match;
    try {
      ({ vaultPages, references } = await inventory(folderId));
      match = await matchCandidateFolder(candidateRoot, references, { fsImpl });
    } catch (error) {
      if (error instanceof FolderMaintenanceError) throw error;
      throw new FolderMaintenanceError(
        'VALIDATION_FAILED',
        'The selected folder could not be validated. No changes were made.'
      );
    }
    if (references.uniqueFileCount && !match.allMatched) {
      const warning = changeWarningText(match);
      if (!(await confirmChange({ ...warning, match }))) return { ok: false, cancelled: true };
    }

    const locationUpdates = new Map(match.results
      .filter((result) => result.status === 'filename')
      .map((result) => [result.relativePath, {
        folderId,
        relativePath: result.matchedRelativePath
      }]));
    const pageChanges = updatedPageBatch(vaultPages, folderId, locationUpdates, { now });
    let pageTransaction;
    try {
      pageTransaction = await beginJsonBatchTransaction(pageChanges, { fsImpl });
    } catch {
      throw new FolderMaintenanceError(
        'RESOURCE_UPDATE_PREPARE_FAILED',
        'Resource path updates could not be prepared. No changes were made.'
      );
    }
    const nextSettings = setFolderRoot(settings, vaultId, folderId, candidateRoot);
    const nextRegistry = withRegisteredFolder(registry, {
      id: folderId,
      name: path.basename(candidateRoot) || target.name
    });
    try {
      await commitRegistryAndSettings({ registry, settings, nextRegistry, nextSettings, pageTransaction });
    } catch {
      throw new FolderMaintenanceError(
        'CHANGE_SAVE_FAILED',
        'The folder and resource changes could not be saved. No changes were kept.'
      );
    }
    return {
      ok: true,
      changed: true,
      folderId,
      matched: match.matched,
      total: match.total,
      updatedRelativePathCount: locationUpdates.size
    };
  }

  async function unlinkUnusedFolder(folderId, registry, settings) {
    const nextRegistry = withoutRegisteredFolder(registry, folderId);
    const nextSettings = removeFolderRoot(settings, vaultId, folderId);
    const pageTransaction = await beginJsonBatchTransaction([], { fsImpl });
    try {
      await commitRegistryAndSettings({ registry, settings, nextRegistry, nextSettings, pageTransaction });
    } catch {
      throw new FolderMaintenanceError(
        'UNLINK_SAVE_FAILED',
        'The folder link could not be removed. No changes were kept.'
      );
    }
    return { ok: true, changed: true, removed: true, migrated: false };
  }

  async function removeReadOnlyFolder(folderId) {
    const registry = normalizeFolderRegistry(await loadRegistry());
    const target = registry.folders.find((folder) => folder.id === folderId);
    if (!target || registry.defaultFolderId === folderId) {
      throw new FolderMaintenanceError('NOT_READ_ONLY', 'A read-only folder is required.');
    }
    const settings = await loadSettings();
    const { vaultPages, references } = await inventory(folderId);
    if (!references.uniqueFileCount) return unlinkUnusedFolder(folderId, registry, settings);

    const approved = await confirmMigration({
      message: 'This folder is still in use.',
      detail: `${references.uniqueFileCount} referenced files are used by ${references.pageCount} pages. Remove the link only after copying those files to the default folder.`,
      references
    });
    if (!approved) return { ok: false, cancelled: true };

    const view = await folderRegistryView(registry, settings, vaultId, { fsImpl });
    const sourceFolder = view.folders.find((folder) => folder.id === folderId);
    const defaultFolder = view.folders.find((folder) => folder.id === view.defaultFolderId);
    if (!defaultFolder?.available) {
      throw new FolderMaintenanceError(
        'DEFAULT_FOLDER_UNAVAILABLE',
        'Choose or relink a healthy default folder before removing this link.'
      );
    }
    if (!sourceFolder?.available) {
      throw new FolderMaintenanceError(
        'SOURCE_FOLDER_UNAVAILABLE',
        `${references.uniqueFileCount} referenced files could not be found. Relink the folder before removing it.`
      );
    }
    if (sourceFolder.realRoot === defaultFolder.realRoot) {
      throw new FolderMaintenanceError('SAME_ROOT', 'The source and default folders must be different.');
    }
    try {
      await fsImpl.access(defaultFolder.realRoot, nodeFs.constants.W_OK);
    } catch {
      throw new FolderMaintenanceError('DEFAULT_NOT_WRITABLE', 'The default folder is not writable.');
    }

    const resolvedSources = [];
    let missingCount = 0;
    for (const source of references.sources) {
      try {
        const resolved = await resolveWorkspaceResourcePath(
          sourceFolder.realRoot,
          source.relativePath,
          { fsImpl }
        );
        resolvedSources.push({ ...source, absolutePath: resolved.absolutePath });
      } catch {
        missingCount += 1;
      }
    }
    if (missingCount) {
      throw new FolderMaintenanceError(
        'MISSING_REFERENCED_FILES',
        `${missingCount} referenced files could not be found. Relink the folder before removing it.`
      );
    }

    let plans;
    try {
      plans = await planCollisionSafeCopies(resolvedSources, defaultFolder.realRoot, { fsImpl });
    } catch (error) {
      if (error instanceof FolderMaintenanceError) throw error;
      throw new FolderMaintenanceError(
        'COPY_PLAN_FAILED',
        'Copies to the default folder could not be planned. No changes were made.'
      );
    }
    const locationUpdates = new Map(plans.map((plan) => [plan.relativePath, {
      folderId: defaultFolder.id,
      relativePath: plan.filename
    }]));
    let pageChanges;
    try {
      pageChanges = updatedPageBatch(vaultPages, folderId, locationUpdates, { now });
    } catch {
      throw new FolderMaintenanceError(
        'MIGRATION_PREPARE_FAILED',
        'Resource reference changes could not be prepared. No changes were made.'
      );
    }
    let createdFiles;
    try {
      createdFiles = await executeCopyPlans(plans, { fsImpl });
    } catch {
      throw new FolderMaintenanceError(
        'COPY_FAILED',
        'Referenced files could not be copied to the default folder. No changes were kept.'
      );
    }
    let pageTransaction = null;
    try {
      pageTransaction = await beginJsonBatchTransaction(pageChanges, { fsImpl });
      const nextRegistry = withoutRegisteredFolder(registry, folderId);
      const nextSettings = removeFolderRoot(settings, vaultId, folderId);
      await commitRegistryAndSettings({
        registry,
        settings,
        nextRegistry,
        nextSettings,
        pageTransaction
      });
      return {
        ok: true,
        changed: true,
        removed: true,
        migrated: true,
        copiedFileCount: plans.length,
        resourceRecordCount: references.resourceRecordCount,
        pageCount: references.pageCount
      };
    } catch {
      if (pageTransaction) await pageTransaction.rollback().catch(() => {});
      await Promise.all(createdFiles.map((filePath) => fsImpl.rm(filePath, { force: true }).catch(() => {})));
      throw new FolderMaintenanceError(
        'MIGRATION_SAVE_FAILED',
        'Migrated resource references could not be saved. No changes were kept.'
      );
    }
  }

  return { changeReadOnlyFolder, inventory, removeReadOnlyFolder };
}

module.exports = {
  FolderMaintenanceError,
  beginJsonBatchTransaction,
  changeWarningText,
  collectFolderReferences,
  createFolderMaintenanceService,
  executeCopyPlans,
  loadVaultPageRecords,
  matchCandidateFolder,
  planCollisionSafeCopies,
  recursiveFilenameIndex,
  updatedPageBatch
};
