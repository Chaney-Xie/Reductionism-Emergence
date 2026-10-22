const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  createDesktopSettings,
  explicitNavigationSortModeForVault,
  externalFileTargetForVault,
  normalizeDesktopSettings,
  navigationSortModeForVault,
  normalizeNavigationSortMode,
  normalizeZoomSensitivity,
  setFolderRoot,
  setExternalFileTarget,
  folderRootsForVault,
  migrateLegacyZoomSensitivities,
  withZoomSensitivity,
  withZoomSensitivityForVault,
  withFolderRootsForVault,
  withNavigationSortMode,
  workspaceRootsForVault,
  zoomSensitivityForVault
} = require('../desktop/desktopSettings');

test('global settings save machine settings atomically without Vault discovery state', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-desktop-settings-'));
  const store = createDesktopSettings({ userDataDir });
  const vaultPath = path.join(userDataDir, 'vault');
  await store.save(withZoomSensitivityForVault(
    { lastVaultPath: vaultPath }, 'project_a', 2.1
  ));
  const persisted = JSON.parse(await fs.readFile(store.settingsPath, 'utf8'));
  assert.deepEqual(persisted.zoomSensitivitiesByVaultId, { project_a: 2.1 });
  assert.equal(Object.hasOwn(persisted, 'zoomSensitivity'), false);
  assert.equal(Object.hasOwn(persisted, 'lastVaultPath'), false);
  assert.equal(Object.hasOwn(persisted, 'workspaceStatesByVaultId'), false);
  assert.deepEqual(await fs.readdir(userDataDir), ['global-settings.json']);
});

test('arbitrary External Link paths are opaque Page refs backed by per-vault machine settings', () => {
  let settings = setExternalFileTarget(
    null, 'project_a', 'external_file_document', '/Users/test/Documents/Paper.pdf'
  );
  settings = setExternalFileTarget(
    settings, 'project_b', 'external_file_document', '/Applications/Viewer.app'
  );
  assert.equal(
    externalFileTargetForVault(settings, 'project_a', 'external_file_document'),
    path.resolve('/Users/test/Documents/Paper.pdf')
  );
  assert.equal(
    externalFileTargetForVault(settings, 'project_b', 'external_file_document'),
    path.resolve('/Applications/Viewer.app')
  );
  assert.equal(externalFileTargetForVault(settings, 'project_missing', 'external_file_document'), null);
});

test('resource folder roots are machine-local and scoped by vault identity', () => {
  let settings = setFolderRoot(null, 'project_a', 'folder_001', '/Volumes/Resources');
  settings = setFolderRoot(settings, 'project_b', 'folder_001', '/Users/test/Resources');
  assert.deepEqual(folderRootsForVault(settings, 'project_a'), {
    folder_001: path.resolve('/Volumes/Resources')
  });
  assert.deepEqual(folderRootsForVault(settings, 'project_b'), {
    folder_001: path.resolve('/Users/test/Resources')
  });
});

test('missing and corrupt desktop settings fail safely', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-desktop-settings-bad-'));
  const store = createDesktopSettings({ userDataDir });
  assert.equal(zoomSensitivityForVault(await store.load(), 'project_a'), 1);
  await fs.writeFile(store.settingsPath, '{bad json', 'utf8');
  assert.equal(zoomSensitivityForVault(await store.load(), 'project_a'), 1);
});

test('legacy desktop settings remain readable only as migration input', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-desktop-settings-legacy-'));
  const store = createDesktopSettings({ userDataDir });
  await fs.writeFile(store.legacySettingsPath, JSON.stringify({ lastVaultPath: '/legacy/vault' }));
  assert.equal((await store.loadLegacyRaw()).lastVaultPath, '/legacy/vault');
});

test('workspace roots are machine settings scoped by stable vault identity', async () => {
  const settings = {
    workspaceRootsByVaultId: {
      project_a: { workspace_lab: '/Volumes/Lab' },
      project_b: { workspace_lab: '/Users/test/Lab' }
    }
  };

  assert.deepEqual(workspaceRootsForVault(settings, 'project_a'), {
    workspace_lab: path.resolve('/Volumes/Lab')
  });
  assert.deepEqual(workspaceRootsForVault(settings, 'project_b'), {
    workspace_lab: path.resolve('/Users/test/Lab')
  });
});

test('updating Vault-scoped machine settings preserves workspace mappings', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-desktop-settings-update-'));
  const store = createDesktopSettings({ userDataDir });
  const configured = {
    workspaceRootsByVaultId: { project_a: { workspace_lab: '/Volumes/Lab' } }
  };
  await store.save(withZoomSensitivityForVault(configured, 'project_a', 1.8));
  const updated = await store.load();

  assert.equal(zoomSensitivityForVault(updated, 'project_a'), 1.8);
  assert.equal(
    updated.workspaceRootsByVaultId.project_a.workspace_lab,
    path.resolve('/Volumes/Lab')
  );
});

test('zoom sensitivity is machine-local, Vault-scoped, validated, and survives reload', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-zoom-settings-'));
  const store = createDesktopSettings({ userDataDir });
  let settings = withZoomSensitivityForVault(null, 'project_a', 2.7);
  settings = withZoomSensitivityForVault(settings, 'project_b', 4.0);
  settings = withZoomSensitivityForVault(settings, 'project_a', 3.4);
  await store.save(settings);
  const loaded = await store.load();
  assert.equal(zoomSensitivityForVault(loaded, 'project_a'), 3.4);
  assert.equal(zoomSensitivityForVault(loaded, 'project_b'), 4.0);
  assert.equal(zoomSensitivityForVault(loaded, 'project_missing'), 1);
  assert.deepEqual(
    JSON.parse(await fs.readFile(store.settingsPath, 'utf8')).zoomSensitivitiesByVaultId,
    { project_a: 3.4, project_b: 4 }
  );
  assert.equal(normalizeZoomSensitivity(undefined), 1);
  assert.equal(normalizeZoomSensitivity('2.0'), 1);
  assert.equal(normalizeZoomSensitivity(0.4), 1);
  assert.equal(normalizeZoomSensitivity(5.1), 1);
  assert.equal(normalizeDesktopSettings({ zoomSensitivity: Number.NaN }).zoomSensitivity, 1);
  assert.equal(normalizeDesktopSettings({ zoomSensitivity: 3.4 }).zoomSensitivity, 3.4);
  assert.throws(
    () => withZoomSensitivityForVault(loaded, 'project_a', 5.1),
    /valid zoom sensitivity/
  );
});

test('legacy scalar zoom sensitivity migrates once to existing Vault identities', async () => {
  const legacy = withZoomSensitivity(null, 2.4);
  const migrated = migrateLegacyZoomSensitivities(legacy, ['project_a', 'project_b']);
  assert.equal(zoomSensitivityForVault(migrated, 'project_a'), 2.4);
  assert.equal(zoomSensitivityForVault(migrated, 'project_b'), 2.4);

  const customised = withZoomSensitivityForVault(migrated, 'project_a', 3.1);
  const repeated = migrateLegacyZoomSensitivities(customised, ['project_a', 'project_b']);
  assert.equal(zoomSensitivityForVault(repeated, 'project_a'), 3.1);
  assert.equal(zoomSensitivityForVault(repeated, 'project_b'), 2.4);
});

test('missing legacy scalar does not pin the current default into Vault settings', () => {
  const migrated = migrateLegacyZoomSensitivities({
    zoomSensitivitiesByVaultId: { project_a: 3.1 }
  }, ['project_a', 'project_b']);
  assert.deepEqual(migrated.zoomSensitivitiesByVaultId, { project_a: 3.1 });
  assert.equal(zoomSensitivityForVault(migrated, 'project_b'), 1);
});

test('Vault-scoped folder save merges into the latest shared settings snapshot', () => {
  const staleFolderSnapshot = setFolderRoot(
    null, 'project_b', 'folder_001', '/Users/test/Resources'
  );
  const latest = withZoomSensitivityForVault(setFolderRoot(
    null, 'project_a', 'folder_001', '/Volumes/Project A Resources'
  ), 'project_a', 3);
  const merged = withFolderRootsForVault(
    latest,
    'project_b',
    folderRootsForVault(staleFolderSnapshot, 'project_b')
  );
  assert.equal(zoomSensitivityForVault(merged, 'project_a'), 3);
  assert.deepEqual(folderRootsForVault(merged, 'project_b'), {
    folder_001: path.resolve('/Users/test/Resources')
  });
  assert.deepEqual(folderRootsForVault(merged, 'project_a'), {
    folder_001: path.resolve('/Volumes/Project A Resources')
  });

  const rolledBackB = withFolderRootsForVault(merged, 'project_b', {});
  assert.equal(zoomSensitivityForVault(rolledBackB, 'project_a'), 3);
  assert.deepEqual(folderRootsForVault(rolledBackB, 'project_a'), {
    folder_001: path.resolve('/Volumes/Project A Resources')
  });
  assert.deepEqual(folderRootsForVault(rolledBackB, 'project_b'), {});
});

test('navigation sort mode is machine-local, vault-scoped, validated, and survives reload', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-navigation-sort-settings-'));
  const store = createDesktopSettings({ userDataDir });
  let settings = withNavigationSortMode(null, 'project_a', 'modified_desc');
  settings = withNavigationSortMode(settings, 'project_b', 'created_asc');
  await store.save(settings);
  const loaded = await store.load();
  assert.equal(navigationSortModeForVault(loaded, 'project_a'), 'modified_desc');
  assert.equal(navigationSortModeForVault(loaded, 'project_b'), 'created_asc');
  assert.equal(navigationSortModeForVault(loaded, 'project_missing'), 'name_asc');
  assert.equal(explicitNavigationSortModeForVault(loaded, 'project_a'), 'modified_desc');
  assert.equal(explicitNavigationSortModeForVault(loaded, 'project_missing'), null);
  assert.equal(explicitNavigationSortModeForVault({
    navigationSortModesByVaultId: { project_a: 'invalid' }
  }, 'project_a'), null);
  assert.equal(normalizeNavigationSortMode(undefined), 'name_asc');
  assert.equal(normalizeNavigationSortMode('invalid'), 'name_asc');
  assert.throws(
    () => withNavigationSortMode(loaded, 'project_a', 'invalid'),
    /valid navigation sort mode/
  );
});
