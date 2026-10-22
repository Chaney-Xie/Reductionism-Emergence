const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  normalizeFolderRegistry,
  withDefaultFolder,
  withRegisteredFolder
} = require('../desktop/folderRegistry');
const { createFolderService, folderRegistryView } = require('../desktop/folderService');
const { createFolderFileService, DEFAULT_FOLDER_MESSAGE } = require('../desktop/folderFileService');
const { setFolderRoot } = require('../desktop/desktopSettings');
const { resolveResourceLocation } = require('../desktop/vaultPaths');

async function makeFile(root, relativePath, contents = 'file') {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents);
  return filePath;
}

test('folder registry keeps one default and changing it does not alter folder identities', () => {
  let registry = normalizeFolderRegistry(null);
  registry = withRegisteredFolder(registry, { id: 'folder_001', name: 'A' }, { makeDefault: true });
  registry = withRegisteredFolder(registry, { id: 'folder_002', name: 'B' });
  assert.equal(registry.defaultFolderId, 'folder_001');
  assert.deepEqual(registry.folders.map((folder) => folder.id), ['folder_001', 'folder_002']);
  const changed = withDefaultFolder(registry, 'folder_002');
  assert.equal(changed.defaultFolderId, 'folder_002');
  assert.deepEqual(changed.folders, registry.folders);
  assert.deepEqual(withDefaultFolder(changed, 'folder_002'), changed);
});

test('folder selection reuses canonical roots and supports default/read-only role changes', async () => {
  const rootA = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-folder-a-'));
  const rootB = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-folder-b-'));
  const aliasB = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-folder-alias-')), 'B');
  await fs.symlink(rootB, aliasB);
  let registry = normalizeFolderRegistry(null);
  let settings = null;
  let selected = rootA;
  let registryWrites = 0;
  const service = createFolderService({
    vaultId: 'project_test',
    loadRegistry: async () => registry,
    saveRegistry: async (next) => { registry = next; registryWrites += 1; return next; },
    loadSettings: async () => settings,
    saveSettings: async (next) => { settings = next; return next; },
    selectFolder: async () => selected
  });

  await service.chooseDefaultFolder();
  const firstDefault = registry.defaultFolderId;
  selected = rootB;
  await service.addReadOnlyFolder();
  const folderB = registry.folders.find((folder) => folder.id !== firstDefault);
  await service.setDefaultFolder(folderB.id);
  assert.equal(registry.defaultFolderId, folderB.id);
  assert.ok(registry.folders.some((folder) => folder.id === firstDefault));

  selected = aliasB;
  const duplicate = await service.addReadOnlyFolder();
  assert.equal(duplicate.changed, false);
  assert.equal(registry.folders.length, 2);
  assert.equal(registryWrites, 3);
});

test('missing folder state is exposed and relink preserves the stable ID and role', async () => {
  const missingRoot = path.join(os.tmpdir(), `viewer-missing-${Date.now()}`);
  const replacement = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-relinked-'));
  let registry = {
    version: 1,
    folders: [{ id: 'folder_001', name: 'Resources' }],
    defaultFolderId: 'folder_001'
  };
  let settings = setFolderRoot(null, 'project_test', 'folder_001', missingRoot);
  const before = await folderRegistryView(registry, settings, 'project_test');
  assert.equal(before.folders[0].available, false);
  assert.match(before.folders[0].error, /Relink/);

  const service = createFolderService({
    vaultId: 'project_test',
    loadRegistry: async () => registry,
    saveRegistry: async (next) => { registry = next; return next; },
    loadSettings: async () => settings,
    saveSettings: async (next) => { settings = next; return next; },
    selectFolder: async () => replacement
  });
  const relinked = await service.relinkFolder('folder_001');
  assert.equal(relinked.registry.defaultFolderId, 'folder_001');
  assert.equal(relinked.registry.folders[0].id, 'folder_001');
  assert.equal(relinked.registry.folders[0].available, true);

  const resourcePath = await makeFile(replacement, 'nested/A.png', 'new');
  const resolved = await resolveResourceLocation('/unused', {
    type: 'folder', folderId: 'folder_001', relativePath: 'nested/A.png'
  }, {
    folderRegistry: registry,
    folderRoots: { folder_001: replacement }
  });
  assert.equal(resolved.absolutePath, await fs.realpath(resourcePath));
});

test('folder state remembers the last healthy mapped-root basename for later missing fallback', async () => {
  const healthyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-folder-current-label-'));
  let registry = {
    version: 1,
    folders: [{ id: 'folder_001', name: 'Stale label' }],
    defaultFolderId: 'folder_001'
  };
  let settings = setFolderRoot(null, 'project_test', 'folder_001', healthyRoot);
  const service = createFolderService({
    vaultId: 'project_test',
    loadRegistry: async () => registry,
    saveRegistry: async (next) => { registry = next; return next; },
    loadSettings: async () => settings,
    saveSettings: async (next) => { settings = next; return next; },
    selectFolder: async () => null
  });

  const healthy = await service.state();
  const currentName = path.basename(await fs.realpath(healthyRoot));
  assert.equal(healthy.folders[0].name, currentName);
  assert.equal(registry.folders[0].name, currentName);

  settings = setFolderRoot(settings, 'project_test', 'folder_001', path.join(healthyRoot, 'missing'));
  const missing = await service.state();
  assert.equal(missing.folders[0].name, currentName);
  assert.equal(missing.folders[0].available, false);
});

test('Add File references registered files and copies outside files only to the default', async () => {
  const defaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-default-folder-'));
  const readOnlyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-readonly-folder-'));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-outside-folder-'));
  const insideDefault = await makeFile(defaultRoot, 'inside.png', 'inside');
  const insideReadOnly = await makeFile(readOnlyRoot, 'model.sdf', 'model');
  const outside = await makeFile(outsideRoot, 'outside.png', 'outside');
  const registry = {
    version: 1,
    folders: [
      { id: 'folder_001', name: 'Default' },
      { id: 'folder_002', name: 'Reference' }
    ],
    defaultFolderId: 'folder_001'
  };
  let settings = setFolderRoot(null, 'project_test', 'folder_001', defaultRoot);
  settings = setFolderRoot(settings, 'project_test', 'folder_002', readOnlyRoot);
  const service = createFolderFileService({
    vaultId: 'project_test',
    loadRegistry: async () => registry,
    loadSettings: async () => settings,
    selectFiles: async () => [insideDefault, insideReadOnly, outside],
    readImageSize: async () => ({ width: 100, height: 50 })
  });
  const result = await service.prepareFiles();
  assert.equal(result.ok, true);
  assert.equal(result.copiedCount, 1);
  assert.deepEqual(result.files.map((file) => file.folderId), [
    'folder_001', 'folder_002', 'folder_001'
  ]);
  assert.equal(result.files[0].relativePath, 'inside.png');
  assert.equal(result.files[1].relativePath, 'model.sdf');
  assert.equal(result.files[2].relativePath, 'outside.png');
  assert.equal(await fs.readFile(outside, 'utf8'), 'outside');
  assert.equal(await fs.readFile(path.join(defaultRoot, 'outside.png'), 'utf8'), 'outside');
});

test('Add File requires a healthy default before copying an outside file', async () => {
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-no-default-source-'));
  const outside = await makeFile(outsideRoot, 'A.png');
  const run = (registry, settings) => createFolderFileService({
    vaultId: 'project_test',
    loadRegistry: async () => registry,
    loadSettings: async () => settings,
    selectFiles: async () => [outside]
  }).prepareFiles();

  await assert.rejects(run({ version: 1, folders: [], defaultFolderId: null }, null), {
    code: 'DEFAULT_FOLDER_UNAVAILABLE', message: DEFAULT_FOLDER_MESSAGE
  });
  const missing = path.join(os.tmpdir(), `viewer-lost-default-${Date.now()}`);
  await assert.rejects(run({
    version: 1,
    folders: [{ id: 'folder_001', name: 'Lost' }],
    defaultFolderId: 'folder_001'
  }, setFolderRoot(null, 'project_test', 'folder_001', missing)), {
    code: 'DEFAULT_FOLDER_UNAVAILABLE', message: DEFAULT_FOLDER_MESSAGE
  });
});

test('Add File falls back to the Vault image and resource folders when no external default is available', async () => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-vault-managed-folders-'));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-vault-managed-source-'));
  const image = await makeFile(outsideRoot, 'A.png', 'image');
  const resource = await makeFile(outsideRoot, 'model.sdf', 'resource');
  const service = createFolderFileService({
    vaultId: 'project_test',
    vaultRoot,
    loadRegistry: async () => ({ version: 1, folders: [], defaultFolderId: null }),
    loadSettings: async () => null,
    selectFiles: async () => [image, resource],
    readImageSize: async () => ({ width: 100, height: 50 })
  });

  const result = await service.prepareFiles();

  assert.equal(result.ok, true);
  assert.equal(result.copiedCount, 2);
  assert.deepEqual(result.files.map((file) => ({
    type: file.type,
    relativePath: file.relativePath
  })), [{
    type: 'vault',
    relativePath: 'assets/images/A.png'
  }, {
    type: 'vault',
    relativePath: 'assets/resources/model.sdf'
  }]);
  assert.equal(await fs.readFile(path.join(vaultRoot, 'assets/images/A.png'), 'utf8'), 'image');
  assert.equal(await fs.readFile(path.join(vaultRoot, 'assets/resources/model.sdf'), 'utf8'), 'resource');
});

test('Add File preserves a healthy explicit external default instead of using the Vault fallback', async () => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-vault-unused-fallback-'));
  const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-explicit-default-'));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-explicit-source-'));
  const image = await makeFile(outsideRoot, 'A.png', 'image');
  const registry = {
    version: 1,
    folders: [{ id: 'folder_001', name: 'External' }],
    defaultFolderId: 'folder_001'
  };
  const service = createFolderFileService({
    vaultId: 'project_test',
    vaultRoot,
    loadRegistry: async () => registry,
    loadSettings: async () => setFolderRoot(null, 'project_test', 'folder_001', externalRoot),
    selectFiles: async () => [image]
  });

  const result = await service.prepareFiles();

  assert.equal(result.files[0].type, 'folder');
  assert.equal(result.files[0].folderId, 'folder_001');
  assert.equal(await fs.readFile(path.join(externalRoot, 'A.png'), 'utf8'), 'image');
  await assert.rejects(fs.access(path.join(vaultRoot, 'assets/images/A.png')), { code: 'ENOENT' });
});

test('Vault Settings and page HTML expose only the new folder and Add File UI', async () => {
  const html = await fs.readFile(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(html, />Links</);
  assert.match(html, /id="add-file-button"[^>]*>Add File<\/button>/);
  assert.doesNotMatch(html, /Add File…/);
  assert.doesNotMatch(html, /Link Original File…|Copy into Vault…/);
  assert.doesNotMatch(html, /resource-choice|workspace-selection|workspace-picker/);
  const settingsMarkup = html.slice(
    html.indexOf('id="vault-settings-overlay"'),
    html.indexOf('id="vault-name-overlay"')
  );
  assert.doesNotMatch(settingsMarkup, />Save<|>Cancel</);
});
