const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  applicationDataRoot,
  createEmptyVault,
  ensureCurrentVault,
  resolveVaultManagedAssetPath,
  resolveVaultPagePath,
  resolveVaultPath,
  validateVault,
  vaultMetadata
} = require('../server/vaultContext');

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function makeLegacyProject(root, { missingAsset = false } = {}) {
  const pageId = 'page_legacy';
  await writeJson(path.join(root, 'data/project.json'), {
    projectId: 'project_legacy',
    projectName: 'Legacy Project',
    version: '0.2.2',
    lastOpenedPageId: pageId,
    appearance: { accentColour: '#123456' }
  });
  await writeJson(path.join(root, 'data/pageIndex.json'), {
    pages: [{ id: pageId, title: 'Legacy Page', path: `pages/${pageId}.json` }]
  });
  await writeJson(path.join(root, 'data/navigation.json'), {
    version: 2,
    folders: [],
    items: [pageId]
  });
  await writeJson(path.join(root, 'data/categories.json'), { groups: [] });
  await writeJson(path.join(root, 'data/descriptors.json'), { entries: [] });
  await writeJson(path.join(root, 'data/vocabulary.json'), { entries: [] });
  await writeJson(path.join(root, 'data/linkTypes.json'), { linkTypes: [] });
  await writeJson(path.join(root, 'data/resourceFolders.json'), {
    version: 1,
    folders: [{ id: 'folder_external', name: 'External' }]
  });
  await writeJson(path.join(root, `data/pages/${pageId}.json`), {
    id: pageId,
    title: 'Legacy Page',
    objects: [{
      id: 'object_image',
      type: 'image',
      location: { type: 'vault', relativePath: 'assets/images/legacy.png' }
    }, {
      id: 'object_external',
      type: 'image',
      location: {
        type: 'folder',
        folderId: 'folder_external',
        relativePath: 'original/external.png'
      }
    }],
    maintenanceResources: [],
    externalLinks: [{
      id: 'external_link_stable',
      fileRef: { type: 'external', externalFileId: 'external_file_stable' }
    }],
    blocks: [{ id: 'block_stable', links: [{ id: 'link_stable', targetPageId: pageId }] }],
    backlinks: [{ id: 'backlink_stable', sourcePageId: pageId }]
  });
  await fs.mkdir(path.join(root, 'assets/images'), { recursive: true });
  await fs.mkdir(path.join(root, 'assets/resources'), { recursive: true });
  if (!missingAsset) await fs.writeFile(path.join(root, 'assets/images/legacy.png'), 'image');
  await fs.writeFile(path.join(root, 'assets/resources/legacy.psd'), 'resource');
}

test('macOS application data root is outside the source tree', () => {
  assert.equal(
    applicationDataRoot({ env: {}, homeDirectory: '/Users/example', platform: 'darwin' }),
    '/Users/example/Library/Application Support/CogNeuro Viewer'
  );
  assert.throws(() => resolveVaultPath(null, 'pages'), /current Vault root/i);
});

test('Vault preflight defers repairable stale Binding members to navigation normalization', async () => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-binding-preflight-'));
  await createEmptyVault(vaultRoot, vaultMetadata({
    vaultId: 'vault_binding_preflight',
    displayName: 'Binding Preflight',
    now: '2026-08-24T00:00:00.000Z'
  }), {});
  const navigationPath = path.join(vaultRoot, 'navigation.json');
  const navigation = JSON.parse(await fs.readFile(navigationPath, 'utf8'));
  assert.equal(navigation.version, 3);
  assert.deepEqual(navigation.bindings, []);
  navigation.bindings = [{
    id: 'binding_stale',
    leaderPageId: 'page_missing_leader',
    followerPageIds: ['page_missing_follower']
  }];
  await writeJson(navigationPath, navigation);

  const validation = await validateVault(vaultRoot);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.unresolvedReferences, []);
});

test('legacy project data migrates atomically into one canonical Default Vault', async () => {
  const legacyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-legacy-root-'));
  const appDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-app-data-'));
  await makeLegacyProject(legacyRoot);
  await writeJson(path.join(appDataRoot, 'desktop-settings.json'), {
    version: 5,
    lastVaultPath: legacyRoot,
    zoomSensitivity: 2.4,
    workspaceStatesByVaultId: {
      project_legacy: {
        searchText: 'preserved workspace',
        navigationSortMode: 'created_desc'
      }
    },
    folderRootsByVaultId: {
      project_legacy: { folder_external: '/Volumes/External' }
    }
  });

  const migrated = await ensureCurrentVault({
    appDataRoot,
    legacyRoot,
    now: '2026-08-01T00:00:00.000Z',
    idFactory: () => 'migration_test'
  });
  assert.equal(migrated.migrated, true);
  assert.equal(migrated.vaultId, 'project_legacy');
  assert.equal(migrated.vaultRoot, path.join(appDataRoot, 'vaults/project_legacy'));
  assert.equal((await validateVault(migrated.vaultRoot)).valid, true);
  assert.equal(JSON.parse(await fs.readFile(
    resolveVaultPagePath(migrated, 'page_legacy'), 'utf8'
  )).blocks[0].id, 'block_stable');
  assert.equal(await fs.readFile(
    resolveVaultManagedAssetPath(migrated, 'images', 'legacy.png'), 'utf8'
  ), 'image');
  assert.equal(await fs.readFile(
    resolveVaultManagedAssetPath(migrated, 'resources', 'legacy.psd'), 'utf8'
  ), 'resource');

  const workspaceState = JSON.parse(await fs.readFile(
    resolveVaultPath(migrated, 'workspaceState.json'), 'utf8'
  ));
  assert.equal(workspaceState.lastOpenedPageId, 'page_legacy');
  assert.equal(workspaceState.workspaceState.searchText, 'preserved workspace');
  assert.equal(Object.hasOwn(workspaceState.workspaceState, 'lastOpenedPageId'), false);
  assert.equal(Object.hasOwn(workspaceState.workspaceState, 'navigationSortMode'), false);
  const globalSettings = JSON.parse(await fs.readFile(
    path.join(appDataRoot, 'global-settings.json'), 'utf8'
  ));
  assert.equal(globalSettings.zoomSensitivity, 2.4);
  assert.deepEqual(globalSettings.navigationSortModesByVaultId, {
    project_legacy: 'created_desc'
  });
  assert.equal(Object.hasOwn(globalSettings, 'lastVaultPath'), false);
  assert.equal(Object.hasOwn(globalSettings, 'workspaceStatesByVaultId'), false);

  const registry = JSON.parse(await fs.readFile(
    path.join(appDataRoot, 'vault-registry.json'), 'utf8'
  ));
  assert.equal(registry.currentVaultId, 'project_legacy');
  assert.equal(registry.vaults.length, 1);
  const report = JSON.parse(await fs.readFile(
    path.join(appDataRoot, 'migration-report.json'), 'utf8'
  ));
  assert.equal(report.counts.pages, 1);
  assert.equal(report.filesCopied.every((entry) => (
    entry.destination.startsWith(migrated.vaultRoot)
      && !entry.destination.includes('.project_legacy.migration')
  )), true);
  assert.equal(await fs.stat(path.join(legacyRoot, 'data.legacy-backup')).then((stat) => stat.isDirectory()), true);
  assert.equal(await fs.stat(path.join(legacyRoot, 'assets.legacy-backup')).then((stat) => stat.isDirectory()), true);

  const restarted = await ensureCurrentVault({
    appDataRoot,
    legacyRoot,
    now: '2026-08-02T00:00:00.000Z'
  });
  assert.equal(restarted.migrated, false);
  const restartedRegistry = JSON.parse(await fs.readFile(
    path.join(appDataRoot, 'vault-registry.json'), 'utf8'
  ));
  assert.equal(restartedRegistry.vaults.length, 1);
  assert.equal(restartedRegistry.currentVaultId, migrated.vaultId);
});

test('critical validation failure leaves legacy data usable and does not publish a registry', async () => {
  const legacyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-legacy-invalid-'));
  const appDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-app-data-invalid-'));
  await makeLegacyProject(legacyRoot, { missingAsset: true });
  await assert.rejects(
    ensureCurrentVault({ appDataRoot, legacyRoot }),
    /unresolved managed references/i
  );
  assert.equal(await fs.stat(path.join(legacyRoot, 'data')).then((stat) => stat.isDirectory()), true);
  await assert.rejects(fs.access(path.join(appDataRoot, 'vault-registry.json')), { code: 'ENOENT' });
  const report = JSON.parse(await fs.readFile(path.join(appDataRoot, 'migration-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.unresolvedReferences[0].relativePath, 'assets/images/legacy.png');
});

test('production Vault-owned paths never append the legacy data directory', async () => {
  const sources = await Promise.all([
    fs.readFile(path.join(__dirname, '../server/appServer.js'), 'utf8'),
    fs.readFile(path.join(__dirname, '../desktop/main.js'), 'utf8'),
    fs.readFile(path.join(__dirname, '../desktop/folderRegistry.js'), 'utf8'),
    fs.readFile(path.join(__dirname, '../desktop/workspaceDefinitions.js'), 'utf8'),
    fs.readFile(path.join(__dirname, '../desktop/folderMaintenanceService.js'), 'utf8')
  ]);
  for (const source of sources) {
    assert.doesNotMatch(source, /path\.join\([^\n]*(?:VAULT_ROOT|vaultRoot|vaultInfo\.vaultRoot)[^\n]*['"]data['"]/);
    assert.doesNotMatch(source, /['"]data\/(?:project|pageIndex|navigation|pages|categories|descriptors|vocabulary|linkTypes)/);
  }
});
