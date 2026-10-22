const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  changeWarningText,
  collectFolderReferences,
  createFolderMaintenanceService,
  matchCandidateFolder
} = require('../desktop/folderMaintenanceService');
const { folderRegistryView } = require('../desktop/folderService');
const { folderRootsForVault, setFolderRoot } = require('../desktop/desktopSettings');

async function makeFile(root, relativePath, contents = 'file') {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents);
  return filePath;
}

async function makeVault(pages) {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-folder-maintenance-vault-'));
  const pagesDir = path.join(vaultRoot, 'pages');
  await fs.mkdir(pagesDir, { recursive: true });
  const index = { pages: [] };
  for (const page of pages) {
    const relativePath = `pages/${page.id}.json`;
    await fs.writeFile(
      path.join(vaultRoot, relativePath),
      `${JSON.stringify(page, null, 2)}\n`,
      'utf8'
    );
    index.pages.push({ id: page.id, title: page.title || page.id, path: relativePath });
  }
  await fs.writeFile(
    path.join(vaultRoot, 'pageIndex.json'),
    `${JSON.stringify(index, null, 2)}\n`,
    'utf8'
  );
  return vaultRoot;
}

function folderLocation(folderId, relativePath) {
  return { type: 'folder', folderId, relativePath };
}

function pageWithResources(id, objects = [], maintenanceResources = []) {
  return {
    id,
    title: id,
    objects,
    maintenanceResources,
    blocks: [{ id: `block_${id}`, objectId: objects[0]?.id || null, links: ['link_1'] }],
    backlinks: [{ id: `backlink_${id}` }],
    descriptors: { class_1: ['descriptor_1'] },
    categories: ['category_1'],
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

function serviceHarness({
  vaultRoot,
  defaultRoot,
  readOnlyRoot,
  selectedRoot = null,
  confirmChange = async () => true,
  confirmMigration = async () => true,
  fsImpl = fs,
  failRemovingRegistry = false
}) {
  let registry = {
    version: 1,
    folders: [
      { id: 'folder_001', name: 'Default stale' },
      { id: 'folder_002', name: 'Read only stale' }
    ],
    defaultFolderId: 'folder_001'
  };
  let settings = setFolderRoot(null, 'project_test', 'folder_001', defaultRoot);
  settings = setFolderRoot(settings, 'project_test', 'folder_002', readOnlyRoot);
  const service = createFolderMaintenanceService({
    vaultId: 'project_test',
    vaultRoot,
    loadRegistry: async () => registry,
    saveRegistry: async (next) => {
      if (failRemovingRegistry && !next.folders.some((folder) => folder.id === 'folder_002')) {
        throw new Error('injected registry failure');
      }
      registry = next;
      return next;
    },
    loadSettings: async () => settings,
    saveSettings: async (next) => { settings = next; return next; },
    selectFolder: async () => selectedRoot,
    confirmChange,
    confirmMigration,
    fsImpl,
    now: () => new Date('2026-07-17T00:00:00.000Z')
  });
  return {
    service,
    registry: () => registry,
    settings: () => settings
  };
}

test('healthy folder names use the canonical mapped-root basename and missing roots keep fallback names', async () => {
  const healthyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-current-name-'));
  const registry = {
    folders: [{ id: 'folder_001', name: 'Stale registry label' }],
    defaultFolderId: 'folder_001'
  };
  const healthySettings = setFolderRoot(null, 'project_test', 'folder_001', healthyRoot);
  const healthy = await folderRegistryView(registry, healthySettings, 'project_test');
  assert.equal(healthy.folders[0].name, path.basename(await fs.realpath(healthyRoot)));

  const missingRoot = path.join(os.tmpdir(), `viewer-name-missing-${Date.now()}`);
  const missingSettings = setFolderRoot(null, 'project_test', 'folder_001', missingRoot);
  const missing = await folderRegistryView(registry, missingSettings, 'project_test');
  assert.equal(missing.folders[0].name, 'Stale registry label');
  assert.equal(missing.folders[0].available, false);
});

test('candidate matching prefers relative paths, accepts one exact filename, and reports ambiguous/missing', async () => {
  const candidate = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-candidate-match-'));
  await makeFile(candidate, 'same/A.png');
  await makeFile(candidate, 'moved/B.psd');
  await makeFile(candidate, 'left/C.txt');
  await makeFile(candidate, 'right/C.txt');
  const references = {
    sources: [
      { relativePath: 'same/A.png', filename: 'A.png', occurrences: [] },
      { relativePath: 'old/B.psd', filename: 'B.psd', occurrences: [] },
      { relativePath: 'old/C.txt', filename: 'C.txt', occurrences: [] },
      { relativePath: 'old/D.csv', filename: 'D.csv', occurrences: [] }
    ],
    uniqueFileCount: 4
  };
  const match = await matchCandidateFolder(candidate, references);
  assert.deepEqual(match.counts, { exact: 1, filename: 1, missing: 1, ambiguous: 1 });
  assert.equal(match.results.find((item) => item.filename === 'B.psd').matchedRelativePath, 'moved/B.psd');
  assert.equal(match.allMatched, false);
  assert.match(changeWarningText(match).detail, /2 of 4 referenced files were found/);

  const zero = { ...match, matched: 0, total: 4 };
  assert.match(changeWarningText(zero).message, /does not appear/);
});

test('Change to updates unique filename paths, folder basename, and preserves folder identity and role', async () => {
  const oldRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-change-old-'));
  const candidate = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-change-new-'));
  const defaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-change-default-'));
  await makeFile(candidate, 'moved/A.png');
  const page = pageWithResources('page_change', [{
    id: 'object_stable',
    location: folderLocation('folder_002', 'old/A.png'),
    x: 12,
    width: 300
  }]);
  const vaultRoot = await makeVault([page]);
  const harness = serviceHarness({
    vaultRoot,
    defaultRoot,
    readOnlyRoot: oldRoot,
    selectedRoot: candidate
  });
  const result = await harness.service.changeReadOnlyFolder('folder_002');
  assert.equal(result.ok, true);
  assert.equal(harness.registry().defaultFolderId, 'folder_001');
  assert.equal(harness.registry().folders[1].id, 'folder_002');
  assert.equal(harness.registry().folders[1].name, path.basename(candidate));
  assert.equal(folderRootsForVault(harness.settings(), 'project_test').folder_002, await fs.realpath(candidate));
  const saved = JSON.parse(await fs.readFile(path.join(vaultRoot, 'pages/page_change.json')));
  assert.equal(saved.objects[0].location.relativePath, 'moved/A.png');
  assert.equal(saved.objects[0].id, 'object_stable');
  assert.equal(saved.blocks[0].id, 'block_page_change');
});

test('Change applies immediately for exact matches or an unused folder and treats its current root as a no-op', async () => {
  const oldRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-change-exact-old-'));
  const candidate = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-change-exact-new-'));
  const defaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-change-exact-default-'));
  await makeFile(candidate, 'nested/A.png');
  const page = pageWithResources('page_exact', [{
    id: 'object_exact', location: folderLocation('folder_002', 'nested/A.png')
  }]);
  const vaultRoot = await makeVault([page]);
  let promptCount = 0;
  const exact = serviceHarness({
    vaultRoot,
    defaultRoot,
    readOnlyRoot: oldRoot,
    selectedRoot: candidate,
    confirmChange: async () => { promptCount += 1; return false; }
  });
  const exactResult = await exact.service.changeReadOnlyFolder('folder_002');
  assert.equal(exactResult.ok, true);
  assert.equal(exactResult.updatedRelativePathCount, 0);
  assert.equal(promptCount, 0);

  const unusedVault = await makeVault([]);
  const unusedCandidate = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-change-unused-new-'));
  const unused = serviceHarness({
    vaultRoot: unusedVault,
    defaultRoot,
    readOnlyRoot: oldRoot,
    selectedRoot: unusedCandidate,
    confirmChange: async () => { promptCount += 1; return false; }
  });
  const unusedResult = await unused.service.changeReadOnlyFolder('folder_002');
  assert.equal(unusedResult.ok, true);
  assert.equal(unusedResult.total, 0);
  assert.equal(promptCount, 0);

  const same = serviceHarness({
    vaultRoot: unusedVault,
    defaultRoot,
    readOnlyRoot: oldRoot,
    selectedRoot: oldRoot
  });
  const sameResult = await same.service.changeReadOnlyFolder('folder_002');
  assert.deepEqual(sameResult, { ok: true, changed: false });
});

test('partial Change cancellation changes nothing; Change anyway updates only confident matches', async () => {
  const oldRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-partial-old-'));
  const candidate = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-partial-new-'));
  const defaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-partial-default-'));
  await makeFile(candidate, 'moved/A.png');
  const page = pageWithResources('page_partial', [{
    id: 'object_a', location: folderLocation('folder_002', 'old/A.png')
  }, {
    id: 'object_b', location: folderLocation('folder_002', 'old/B.png')
  }]);

  const cancelVault = await makeVault([page]);
  let cancelSummary = null;
  const cancelled = serviceHarness({
    vaultRoot: cancelVault,
    defaultRoot,
    readOnlyRoot: oldRoot,
    selectedRoot: candidate,
    confirmChange: async (summary) => { cancelSummary = summary; return false; }
  });
  const before = await fs.readFile(path.join(cancelVault, 'pages/page_partial.json'), 'utf8');
  const result = await cancelled.service.changeReadOnlyFolder('folder_002');
  assert.equal(result.cancelled, true);
  assert.equal(cancelSummary.match.matched, 1);
  assert.equal(cancelSummary.match.counts.missing, 1);
  assert.equal(await fs.readFile(path.join(cancelVault, 'pages/page_partial.json'), 'utf8'), before);
  assert.equal(folderRootsForVault(cancelled.settings(), 'project_test').folder_002, oldRoot);

  const anywayVault = await makeVault([page]);
  const changed = serviceHarness({
    vaultRoot: anywayVault,
    defaultRoot,
    readOnlyRoot: oldRoot,
    selectedRoot: candidate,
    confirmChange: async () => true
  });
  await changed.service.changeReadOnlyFolder('folder_002');
  const saved = JSON.parse(await fs.readFile(path.join(anywayVault, 'pages/page_partial.json')));
  assert.equal(saved.objects[0].location.relativePath, 'moved/A.png');
  assert.equal(saved.objects[1].location.relativePath, 'old/B.png');
  assert.equal(saved.objects[1].location.folderId, 'folder_002');
});

test('Change rejects another registered canonical root and leaves the folder unchanged', async () => {
  const oldRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-duplicate-old-'));
  const defaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-duplicate-default-'));
  const vaultRoot = await makeVault([]);
  const harness = serviceHarness({
    vaultRoot,
    defaultRoot,
    readOnlyRoot: oldRoot,
    selectedRoot: defaultRoot
  });
  await assert.rejects(harness.service.changeReadOnlyFolder('folder_002'), {
    code: 'DUPLICATE_FOLDER',
    message: 'This folder is already linked.'
  });
  assert.equal(folderRootsForVault(harness.settings(), 'project_test').folder_002, oldRoot);
});

test('unused read-only folders unlink without touching external files', async () => {
  const oldRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-unlink-unused-'));
  const sourceFile = await makeFile(oldRoot, 'keep.txt', 'keep');
  const defaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-unlink-default-'));
  const vaultRoot = await makeVault([]);
  const harness = serviceHarness({ vaultRoot, defaultRoot, readOnlyRoot: oldRoot });
  const result = await harness.service.removeReadOnlyFolder('folder_002');
  assert.equal(result.migrated, false);
  assert.equal(harness.registry().folders.some((folder) => folder.id === 'folder_002'), false);
  assert.equal(folderRootsForVault(harness.settings(), 'project_test').folder_002, undefined);
  assert.equal(await fs.readFile(sourceFile, 'utf8'), 'keep');
});

test('referenced removal offers migration only and cancellation preserves state', async () => {
  const oldRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-remove-cancel-old-'));
  await makeFile(oldRoot, 'A.png');
  const defaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-remove-cancel-default-'));
  const page = pageWithResources('page_cancel', [{
    id: 'object_a', location: folderLocation('folder_002', 'A.png')
  }]);
  const vaultRoot = await makeVault([page]);
  let prompt = null;
  const harness = serviceHarness({
    vaultRoot,
    defaultRoot,
    readOnlyRoot: oldRoot,
    confirmMigration: async (value) => { prompt = value; return false; }
  });
  const result = await harness.service.removeReadOnlyFolder('folder_002');
  assert.equal(result.cancelled, true);
  assert.equal(prompt.references.uniqueFileCount, 1);
  assert.equal(prompt.references.pageCount, 1);
  assert.equal(harness.registry().folders.some((folder) => folder.id === 'folder_002'), true);
});

test('migration blocks unhealthy defaults and missing sources before copying', async () => {
  const oldRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-remove-precondition-old-'));
  const defaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-remove-precondition-default-'));
  const page = pageWithResources('page_missing', [{
    id: 'object_missing', location: folderLocation('folder_002', 'missing.png')
  }]);
  const vaultRoot = await makeVault([page]);
  const missingSource = serviceHarness({ vaultRoot, defaultRoot, readOnlyRoot: oldRoot });
  await assert.rejects(missingSource.service.removeReadOnlyFolder('folder_002'), {
    code: 'MISSING_REFERENCED_FILES'
  });
  assert.deepEqual(await fs.readdir(defaultRoot), []);
  assert.equal(missingSource.registry().folders.some((folder) => folder.id === 'folder_002'), true);

  const unavailableDefault = path.join(os.tmpdir(), `viewer-default-lost-${Date.now()}`);
  const blocked = serviceHarness({ vaultRoot, defaultRoot: unavailableDefault, readOnlyRoot: oldRoot });
  await assert.rejects(blocked.service.removeReadOnlyFolder('folder_002'), {
    code: 'DEFAULT_FOLDER_UNAVAILABLE'
  });
});

test('migration copies duplicate references once, uses collision-safe naming, and preserves identities', async () => {
  const oldRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-migrate-old-'));
  const defaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-migrate-default-'));
  const sourceFile = await makeFile(oldRoot, 'nested/shared.dat', 'source');
  await makeFile(defaultRoot, 'shared.dat', 'different');
  const page = pageWithResources('page_migrate', [{
    id: 'object_shared',
    location: folderLocation('folder_002', 'nested/shared.dat'),
    x: 42,
    visible: true
  }], [{
    id: 'resource_shared',
    location: folderLocation('folder_002', 'nested/shared.dat'),
    visible: false
  }]);
  const originalIdentity = cloneForIdentity(page);
  const vaultRoot = await makeVault([page]);
  let copyCount = 0;
  const fsImpl = {
    ...fs,
    copyFile: async (...args) => { copyCount += 1; return fs.copyFile(...args); }
  };
  const harness = serviceHarness({ vaultRoot, defaultRoot, readOnlyRoot: oldRoot, fsImpl });
  const result = await harness.service.removeReadOnlyFolder('folder_002');
  assert.equal(result.copiedFileCount, 1);
  assert.equal(copyCount, 1);
  assert.equal(await fs.readFile(path.join(defaultRoot, 'shared_1.dat'), 'utf8'), 'source');
  assert.equal(await fs.readFile(sourceFile, 'utf8'), 'source');

  const saved = JSON.parse(await fs.readFile(path.join(vaultRoot, 'pages/page_migrate.json')));
  assert.equal(saved.objects[0].location.folderId, 'folder_001');
  assert.equal(saved.objects[0].location.relativePath, 'shared_1.dat');
  assert.deepEqual(saved.maintenanceResources[0].location, saved.objects[0].location);
  assert.deepEqual(cloneForIdentity(saved), originalIdentity);
  assert.equal(harness.registry().folders.some((folder) => folder.id === 'folder_002'), false);
});

function cloneForIdentity(page) {
  return {
    pageId: page.id,
    objectIds: (page.objects || []).map((item) => item.id),
    resourceIds: (page.maintenanceResources || []).map((item) => item.id),
    blocks: page.blocks,
    backlinks: page.backlinks,
    descriptors: page.descriptors,
    categories: page.categories,
    objectPlacement: (page.objects || []).map(({ x, visible }) => ({ x, visible }))
  };
}

test('migration rollback restores page references, registry, settings, and copied files', async () => {
  const oldRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-rollback-old-'));
  const defaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-rollback-default-'));
  await makeFile(oldRoot, 'rollback.txt', 'source');
  const page = pageWithResources('page_rollback', [{
    id: 'object_rollback', location: folderLocation('folder_002', 'rollback.txt')
  }]);
  const vaultRoot = await makeVault([page]);
  const pagePath = path.join(vaultRoot, 'pages/page_rollback.json');
  const before = await fs.readFile(pagePath, 'utf8');
  const harness = serviceHarness({
    vaultRoot,
    defaultRoot,
    readOnlyRoot: oldRoot,
    failRemovingRegistry: true
  });
  await assert.rejects(harness.service.removeReadOnlyFolder('folder_002'), {
    code: 'MIGRATION_SAVE_FAILED',
    message: 'Migrated resource references could not be saved. No changes were kept.'
  });
  assert.equal(await fs.readFile(pagePath, 'utf8'), before);
  assert.equal(harness.registry().folders.some((folder) => folder.id === 'folder_002'), true);
  assert.equal(folderRootsForVault(harness.settings(), 'project_test').folder_002, oldRoot);
  assert.deepEqual(await fs.readdir(defaultRoot), []);
});

test('folder reference inventory counts unique physical paths separately from records and pages', () => {
  const pages = [{ page: pageWithResources('page_1', [{
    id: 'object_1', location: folderLocation('folder_002', 'A.png')
  }], [{
    id: 'resource_1', location: folderLocation('folder_002', 'A.png')
  }]) }, { page: pageWithResources('page_2', [{
    id: 'object_2', location: folderLocation('folder_002', 'B.png')
  }]) }];
  const inventory = collectFolderReferences(pages, 'folder_002');
  assert.equal(inventory.uniqueFileCount, 2);
  assert.equal(inventory.resourceRecordCount, 3);
  assert.equal(inventory.pageCount, 2);
});
