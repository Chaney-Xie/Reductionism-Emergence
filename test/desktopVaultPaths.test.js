const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  normalizeResourceRelativePath,
  resolveResourceLocation,
  resolveVaultResourcePath,
  validateVaultRoot
} = require('../desktop/vaultPaths');

async function makeValidVault(root) {
  await fs.mkdir(path.join(root, 'pages'), { recursive: true });
  await fs.mkdir(path.join(root, 'assets/images'), { recursive: true });
  await fs.mkdir(path.join(root, 'assets/resources'), { recursive: true });
  await fs.writeFile(path.join(root, 'vault.json'), JSON.stringify({
    vaultId: 'vault_test',
    displayName: 'Test Vault',
    schemaVersion: 1
  }));
  await fs.writeFile(path.join(root, 'pageIndex.json'), JSON.stringify({ pages: [] }));
  await fs.writeFile(path.join(root, 'navigation.json'), JSON.stringify({
    version: 2,
    folders: [],
    items: []
  }));
  await fs.writeFile(path.join(root, 'categories.json'), JSON.stringify({ groups: [] }));
  await fs.writeFile(path.join(root, 'descriptors.json'), JSON.stringify({ entries: [] }));
  await fs.writeFile(path.join(root, 'vocabulary.json'), JSON.stringify({ entries: [] }));
  await fs.writeFile(path.join(root, 'linkTypes.json'), JSON.stringify({ linkTypes: [] }));
  await fs.writeFile(path.join(root, 'workspaceState.json'), JSON.stringify({
    schemaVersion: 1,
    lastOpenedPageId: null,
    workspaceState: null
  }));
}

test('vault validation accepts the current minimum structure without mutating it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-vault-valid-'));
  await makeValidVault(root);
  const before = (await fs.readdir(root)).sort();
  const result = await validateVaultRoot(root);
  const after = (await fs.readdir(root)).sort();
  assert.equal(result.valid, true);
  assert.equal(result.projectName, 'Test Vault');
  assert.deepEqual(after, before);
});

test('vault validation rejects missing structure and arbitrary folders', async () => {
  const arbitrary = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-vault-invalid-'));
  const result = await validateVaultRoot(arbitrary);
  assert.equal(result.valid, false);
  assert.ok(result.missing.includes('vault.json'));
  assert.deepEqual(await fs.readdir(arbitrary), []);
});

test('safe resource resolution accepts normal and nested vault resources', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-resource-valid-'));
  await makeValidVault(root);
  const imagePath = path.join(root, 'assets/images/example.png');
  const nestedPath = path.join(root, 'assets/resources/models/example.sdf');
  await fs.writeFile(imagePath, 'image');
  await fs.mkdir(path.dirname(nestedPath), { recursive: true });
  await fs.writeFile(nestedPath, 'model');
  const realImagePath = await fs.realpath(imagePath);
  const realNestedPath = await fs.realpath(nestedPath);

  assert.equal(
    (await resolveVaultResourcePath(root, 'assets/images/example.png')).absolutePath,
    realImagePath
  );
  assert.equal(
    (await resolveVaultResourcePath(root, 'assets/resources/models/example.sdf')).absolutePath,
    realNestedPath
  );
});

test('safe resource resolution rejects traversal, absolute, unsupported, and missing paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-resource-invalid-'));
  await makeValidVault(root);
  assert.throws(() => normalizeResourceRelativePath('../secret.txt'), { code: 'PATH_TRAVERSAL' });
  assert.throws(() => normalizeResourceRelativePath('/tmp/secret.txt'), { code: 'ABSOLUTE_PATH' });
  assert.throws(() => normalizeResourceRelativePath('data/project.json'), { code: 'UNSUPPORTED_PATH' });
  await assert.rejects(
    resolveVaultResourcePath(root, 'assets/resources/missing.psd'),
    { code: 'NOT_FOUND' }
  );
});

test('safe resource resolution rejects symlink escape', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-resource-symlink-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-resource-outside-'));
  await makeValidVault(root);
  const outsideFile = path.join(outside, 'outside.psd');
  await fs.writeFile(outsideFile, 'outside');
  await fs.symlink(outsideFile, path.join(root, 'assets/resources/escape.psd'));
  await assert.rejects(
    resolveVaultResourcePath(root, 'assets/resources/escape.psd'),
    { code: 'SYMLINK_ESCAPE' }
  );
});

test('workspace resources resolve relative to the registered machine root', async () => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-workspace-vault-'));
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-workspace-root-'));
  await makeValidVault(vaultRoot);
  await fs.mkdir(path.join(workspaceRoot, 'models'), { recursive: true });
  const filePath = path.join(workspaceRoot, 'models/example.sdf');
  await fs.writeFile(filePath, 'model');
  const resolved = await resolveResourceLocation(vaultRoot, {
    type: 'workspace',
    workspaceId: 'workspace_lab',
    relativePath: 'models/example.sdf'
  }, {
    workspaceDefinitions: {
      workspaces: { workspace_lab: { id: 'workspace_lab', label: 'Lab' } }
    },
    workspaceRoots: { workspace_lab: workspaceRoot }
  });

  assert.equal(resolved.absolutePath, await fs.realpath(filePath));
  assert.equal(resolved.location.workspaceId, 'workspace_lab');
});

test('workspace resolution rejects unknown and unmapped workspaces', async () => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-workspace-unknown-'));
  await makeValidVault(vaultRoot);
  const location = {
    type: 'workspace',
    workspaceId: 'workspace_lab',
    relativePath: 'model.sdf'
  };
  await assert.rejects(resolveResourceLocation(vaultRoot, location), {
    code: 'UNKNOWN_WORKSPACE'
  });
  await assert.rejects(resolveResourceLocation(vaultRoot, location, {
    workspaceDefinitions: {
      workspaces: { workspace_lab: { id: 'workspace_lab', label: 'Lab' } }
    }
  }), { code: 'WORKSPACE_UNMAPPED' });
});

test('workspace resolution rejects traversal, absolute paths, and symlink escape', async () => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-workspace-safe-vault-'));
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-workspace-safe-root-'));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-workspace-safe-outside-'));
  await makeValidVault(vaultRoot);
  const options = {
    workspaceDefinitions: {
      workspaces: { workspace_lab: { id: 'workspace_lab', label: 'Lab' } }
    },
    workspaceRoots: { workspace_lab: workspaceRoot }
  };
  const location = (relativePath) => ({
    type: 'workspace', workspaceId: 'workspace_lab', relativePath
  });

  await assert.rejects(resolveResourceLocation(vaultRoot, location('../secret'), options), {
    code: 'PATH_TRAVERSAL'
  });
  await assert.rejects(resolveResourceLocation(vaultRoot, location('/tmp/secret'), options), {
    code: 'ABSOLUTE_PATH'
  });
  const outsideFile = path.join(outsideRoot, 'outside.psd');
  await fs.writeFile(outsideFile, 'outside');
  await fs.symlink(outsideFile, path.join(workspaceRoot, 'escape.psd'));
  await assert.rejects(resolveResourceLocation(vaultRoot, location('escape.psd'), options), {
    code: 'SYMLINK_ESCAPE'
  });
});
