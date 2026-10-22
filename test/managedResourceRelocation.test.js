const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createManagedResourceRelocator } = require('../desktop/managedResourceRelocator');
const { createDisplayProxyService } = require('../desktop/displayProxyService');
const { resolveWorkspaceResourcePath } = require('../desktop/vaultPaths');

function folderLocation(relativePath) {
  return { type: 'folder', folderId: 'folder_001', relativePath };
}

async function harness(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-managed-relocation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const persisted = [];
  const relocator = createManagedResourceRelocator({
    resolveDirect: async (location) => ({
      ...(await resolveWorkspaceResourcePath(root, location.relativePath)),
      location
    }),
    managedRoot: async (location) => ({
      rootPath: root,
      toLocation: (relativePath) => ({ ...location, relativePath })
    }),
    persistRelocation: async (value) => {
      persisted.push(value);
      return { location: value.nextLocation };
    }
  });
  return { root, relocator, persisted };
}

test('a uniquely verified managed file move recovers its new path and preserves stable identity context', async (t) => {
  const { root, relocator, persisted } = await harness(t);
  const original = path.join(root, 'ChimeraX/D-Glucose.sdf');
  const moved = path.join(root, 'ChimeraX/Saccharides/D-Glucose.sdf');
  await fs.mkdir(path.dirname(original), { recursive: true });
  await fs.writeFile(original, 'glucose-source');
  const size = (await fs.stat(original)).size;
  const context = {
    pageId: 'page_001', resourceId: 'resource_001',
    resource: { id: 'resource_001', originalName: 'D-Glucose.sdf', size }
  };
  await relocator.resolve(folderLocation('ChimeraX/D-Glucose.sdf'), context);
  await fs.mkdir(path.dirname(moved), { recursive: true });
  await fs.rename(original, moved);

  const resolved = await relocator.resolve(folderLocation('ChimeraX/D-Glucose.sdf'), context);
  assert.equal(resolved.absolutePath, await fs.realpath(moved));
  assert.equal(resolved.relocated, true);
  assert.deepEqual(resolved.location, folderLocation('ChimeraX/Saccharides/D-Glucose.sdf'));
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].pageId, 'page_001');
  assert.equal(persisted[0].resourceId, 'resource_001');
});

test('restart recovery uses one exact full filename without trusting stale imported size', async (t) => {
  const { root, relocator, persisted } = await harness(t);
  const moved = path.join(root, 'new/place/D-Glucose.sdf');
  await fs.mkdir(path.dirname(moved), { recursive: true });
  await fs.writeFile(moved, 'same-size-source');
  const resolved = await relocator.resolve(folderLocation('old/D-Glucose.sdf'), {
    pageId: 'page_001', resourceId: 'resource_001',
    resource: { id: 'resource_001', size: 1 }
  });
  assert.equal(resolved.absolutePath, await fs.realpath(moved));
  assert.equal(persisted.length, 1);
});

test('deleted and ambiguous managed files remain missing without a guessed relocation', async (t) => {
  const deleted = await harness(t);
  await assert.rejects(
    deleted.relocator.resolve(folderLocation('old/D-Glucose.sdf'), {
      pageId: 'page_001', resourceId: 'resource_001', resource: { size: 12 }
    }),
    { code: 'NOT_FOUND' }
  );
  assert.equal(deleted.persisted.length, 0);

  const ambiguous = await harness(t);
  for (const directory of ['one', 'two']) {
    const candidate = path.join(ambiguous.root, directory, 'D-Glucose.sdf');
    await fs.mkdir(path.dirname(candidate), { recursive: true });
    await fs.writeFile(candidate, 'same-content');
  }
  await assert.rejects(
    ambiguous.relocator.resolve(folderLocation('old/D-Glucose.sdf'), {
      pageId: 'page_001', resourceId: 'resource_001',
      resource: { size: Buffer.byteLength('same-content') }
    }),
    { code: 'NOT_FOUND' }
  );
  assert.equal(ambiguous.persisted.length, 0);
});

test('unmanaged calls without stable Page and resource context never scan or relocate', async (t) => {
  const { root, relocator, persisted } = await harness(t);
  const candidate = path.join(root, 'new/external.pdf');
  await fs.mkdir(path.dirname(candidate), { recursive: true });
  await fs.writeFile(candidate, 'external');
  await assert.rejects(relocator.resolve(folderLocation('old/external.pdf')), { code: 'NOT_FOUND' });
  assert.equal(persisted.length, 0);
});

test('Canvas display-proxy resolution repairs a moved source before the first display tier', async (t) => {
  const { root, relocator, persisted } = await harness(t);
  const cacheRoot = path.join(root, '.proxy-cache');
  const moved = path.join(root, 'new/D-Glucose.png');
  await fs.mkdir(path.dirname(moved), { recursive: true });
  await fs.writeFile(moved, Buffer.alloc(256, 7));
  const resource = {
    id: 'object_001', type: 'image', displayable: true,
    naturalWidth: 2048, naturalHeight: 1024, size: 256,
    location: folderLocation('old/D-Glucose.png')
  };
  const service = createDisplayProxyService({
    vaultId: 'project_001',
    cacheRoot,
    loadResource: async () => resource,
    resolveLocation: (location, context) => relocator.resolve(location, context),
    probeImage: async () => ({ width: 2048, height: 1024 }),
    generateProxy: async ({ destinationPath, maxLongEdge }) => {
      await fs.writeFile(destinationPath, Buffer.alloc(32, 3));
      return { width: maxLongEdge, height: maxLongEdge / 2 };
    }
  });
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const response = await service.requestVariant({
    pageId: 'page_001', objectId: 'object_001', requiredLongEdge: 1024
  }, resolveReady);
  assert.equal(response.ok, true);
  assert.deepEqual(response.relocation.location, folderLocation('new/D-Glucose.png'));
  const firstTier = await ready;
  assert.equal(firstTier.objectId, 'object_001');
  assert.equal(firstTier.variant.tier, 1024);
  assert.equal(persisted.length, 1);
});
