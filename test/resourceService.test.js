const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createResourceService,
  unlinkAllPageResources,
  unlinkPageMaintenanceResource,
  unlinkPageObject,
  unlinkPageResource
} = require('../server/resourceService');

test('canonical Object and Maintenance unlink owners never touch their Vault files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-resource-unlink-'));
  const objectPath = path.join(root, 'assets/images/object.png');
  const maintenancePath = path.join(root, 'assets/resources/model.psd');
  await fs.mkdir(path.dirname(objectPath), { recursive: true });
  await fs.mkdir(path.dirname(maintenancePath), { recursive: true });
  await fs.writeFile(objectPath, 'object target');
  await fs.writeFile(maintenancePath, 'maintenance target');

  const page = {
    objects: [{
      id: 'object_linked',
      location: { type: 'vault', relativePath: 'assets/images/object.png' }
    }, {
      id: 'object_survivor',
      location: { type: 'vault', relativePath: 'assets/images/survivor.png' }
    }],
    maintenanceResources: [{
      id: 'resource_linked',
      location: { type: 'vault', relativePath: 'assets/resources/model.psd' }
    }],
    blocks: [{
      id: 'block_linked',
      objectId: 'object_linked',
      links: [{ id: 'link_1', targetType: 'page', targetPageId: 'page_other' }]
    }, {
      id: 'block_survivor',
      objectId: 'object_survivor',
      links: []
    }],
    highlightGroups: [{
      id: 'highlight_group_mixed',
      name: 'Mixed',
      blockIds: ['block_linked', 'block_survivor']
    }, {
      id: 'highlight_group_removed',
      name: 'Removed',
      blockIds: ['block_linked']
    }]
  };

  try {
    const objectUnlink = unlinkPageObject(page, 'object_linked');
    assert.equal(objectUnlink.unlinkedKind, 'object');
    assert.equal(objectUnlink.unlinkedItem.id, 'object_linked');
    assert.equal(objectUnlink.removedBlockCount, 1);
    assert.deepEqual(page.objects.map((object) => object.id), ['object_survivor']);
    assert.deepEqual(page.blocks.map((block) => block.id), ['block_survivor']);
    assert.deepEqual(page.highlightGroups, [{
      id: 'highlight_group_mixed',
      name: 'Mixed',
      blockIds: ['block_survivor']
    }]);

    const maintenanceUnlink = unlinkPageMaintenanceResource(page, 'resource_linked');
    assert.equal(maintenanceUnlink.unlinkedKind, 'resource');
    assert.equal(maintenanceUnlink.unlinkedItem.id, 'resource_linked');
    assert.equal(maintenanceUnlink.removedBlockCount, 0);
    assert.deepEqual(page.maintenanceResources, []);

    assert.equal(await fs.readFile(objectPath, 'utf8'), 'object target');
    assert.equal(await fs.readFile(maintenancePath, 'utf8'), 'maintenance target');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('per-item dispatch and Page destruction coordinator reuse the kind-specific owners', () => {
  const page = {
    objects: [{ id: 'object_a' }, { id: 'object_b' }],
    maintenanceResources: [{ id: 'resource_a' }, { id: 'resource_b' }],
    blocks: [{ id: 'block_a', objectId: 'object_a' }],
    highlightGroups: [{ id: 'group_a', name: 'A', blockIds: ['block_a'] }]
  };

  const one = unlinkPageResource(page, 'resource_a');
  assert.equal(one.unlinkedKind, 'resource');
  assert.deepEqual(page.maintenanceResources.map((resource) => resource.id), ['resource_b']);

  const all = unlinkAllPageResources(page);
  assert.deepEqual(all.objectUnlinks.map((unlink) => unlink.unlinkedItem.id), [
    'object_a',
    'object_b'
  ]);
  assert.deepEqual(all.maintenanceUnlinks.map((unlink) => unlink.unlinkedItem.id), ['resource_b']);
  assert.equal(all.removedBlockCount, 1);
  assert.deepEqual(page.objects, []);
  assert.deepEqual(page.maintenanceResources, []);
  assert.deepEqual(page.blocks, []);
  assert.deepEqual(page.highlightGroups, []);
});

test('only the explicit Page destruction phase deletes an unshared Vault Object file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-page-resource-destruction-'));
  const unsharedPath = path.join(root, 'assets/images/unshared.png');
  const sharedPath = path.join(root, 'assets/images/shared.png');
  const maintenancePath = path.join(root, 'assets/resources/maintenance.bin');
  const survivorPath = path.join(root, 'pages/survivor.json');
  await fs.mkdir(path.dirname(unsharedPath), { recursive: true });
  await fs.mkdir(path.dirname(maintenancePath), { recursive: true });
  await fs.mkdir(path.dirname(survivorPath), { recursive: true });
  await fs.writeFile(unsharedPath, 'unshared object');
  await fs.writeFile(sharedPath, 'shared object');
  await fs.writeFile(maintenancePath, 'maintenance file');
  await fs.writeFile(survivorPath, JSON.stringify({
    objects: [],
    maintenanceResources: [{
      id: 'resource_shared_elsewhere',
      location: { type: 'vault', relativePath: 'assets/images/shared.png' }
    }]
  }));

  const service = createResourceService({
    root,
    safePageFilePath: (entry) => path.join(root, entry.path),
    readJson: async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8')),
    deletePageOwnedFile: (filePath) => fs.rm(filePath, { force: true })
  });
  const objectUnlinks = [{
    unlinkedItem: {
      id: 'object_unshared',
      location: { type: 'vault', relativePath: 'assets/images/unshared.png' }
    }
  }, {
    unlinkedItem: {
      id: 'object_shared',
      location: { type: 'vault', relativePath: 'assets/images/shared.png' }
    }
  }, {
    unlinkedItem: {
      id: 'object_external',
      location: { type: 'folder', folderId: 'folder_1', relativePath: 'outside.png' }
    }
  }];

  try {
    const deletedAssets = await service.deletePageDestructionObjectFiles(
      objectUnlinks,
      { pages: [{ id: 'page_survivor', path: 'pages/survivor.json' }] },
      'page_deleted'
    );
    assert.deepEqual(deletedAssets, ['assets/images/unshared.png']);
    await assert.rejects(fs.access(unsharedPath), { code: 'ENOENT' });
    assert.equal(await fs.readFile(sharedPath, 'utf8'), 'shared object');
    assert.equal(await fs.readFile(maintenancePath, 'utf8'), 'maintenance file');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('production ownership keeps ordinary unlink separate from Page physical destruction', async () => {
  const resourceSource = await fs.readFile(
    path.join(__dirname, '../server/resourceService.js'),
    'utf8'
  );
  const serverSource = await fs.readFile(path.join(__dirname, '../server/appServer.js'), 'utf8');
  const ordinaryRouteStart = serverSource.indexOf(
    "app.delete('/api/pages/:pageId/resources/:itemId'"
  );
  const pageRouteStart = serverSource.indexOf("app.delete('/api/pages/:pageId',");
  assert.ok(ordinaryRouteStart >= 0);
  assert.ok(pageRouteStart > ordinaryRouteStart);

  const ordinaryRoute = serverSource.slice(ordinaryRouteStart, pageRouteStart);
  const pageRoute = serverSource.slice(pageRouteStart);
  assert.match(ordinaryRoute, /unlinkPageResource\(page, req\.params\.itemId\)/);
  assert.doesNotMatch(ordinaryRoute, /deletePageDestructionObjectFiles|deletePageOwnedFile/);
  assert.match(pageRoute, /unlinkAllPageResources\(deletedPage\)/);
  assert.match(pageRoute, /deletePageDestructionObjectFiles\(/);

  assert.doesNotMatch(
    resourceSource,
    /deleteMaintenanceAssetIfUnused|assetSrcStillReferenced|deleteUnreferencedPageAssets/
  );
  const coordinatorStart = resourceSource.indexOf('function unlinkAllPageResources');
  const serviceStart = resourceSource.indexOf('function createResourceService');
  const coordinator = resourceSource.slice(coordinatorStart, serviceStart);
  assert.match(coordinator, /unlinkPageObject\(page, objectId\)/);
  assert.match(coordinator, /unlinkPageMaintenanceResource\(page, resourceId\)/);
});
