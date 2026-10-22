const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test('desktop linked-resource HTTP lifecycle uses stable IDs and preserves originals', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-http-vault-'));
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-http-workspace-'));
  const folderRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-http-folder-'));
  const externalFolderRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-http-external-folder-'));
  const pageId = 'page_http_test';
  const survivorPageId = 'page_http_survivor';
  const pagePath = path.join(vaultRoot, 'pages/http-page.json');
  const survivorPagePath = path.join(vaultRoot, 'pages/http-survivor.json');
  const firstImage = path.join(workspaceRoot, 'A.png');
  const secondImage = path.join(workspaceRoot, 'B.png');
  const modelFile = path.join(workspaceRoot, 'model.psd');
  const folderImage = path.join(folderRoot, 'C.png');
  const externalFolderImage = path.join(externalFolderRoot, 'D.png');
  const sharedVaultImage = path.join(vaultRoot, 'assets/images/shared-page-object.png');
  const token = 'desktop-test-token-123456789';

  await fs.mkdir(path.join(vaultRoot, 'assets/images'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, 'assets/resources'), { recursive: true });
  await fs.writeFile(firstImage, Buffer.from('first-image'));
  await fs.writeFile(secondImage, Buffer.from('second-image'));
  await fs.writeFile(modelFile, Buffer.from('psd-original'));
  await fs.writeFile(folderImage, Buffer.from('folder-image'));
  await fs.writeFile(externalFolderImage, Buffer.from('external-folder-image'));
  await fs.writeFile(sharedVaultImage, Buffer.from('shared-vault-image'));
  await writeJson(path.join(vaultRoot, 'vault.json'), {
    projectId: 'project_http_test',
    projectName: 'HTTP Test',
    version: '0.2.2',
    lastOpenedPageId: pageId
  });
  await writeJson(path.join(vaultRoot, 'pageIndex.json'), {
    pages: [{
      id: pageId,
      title: 'HTTP Test',
      path: 'pages/http-page.json',
      categories: [],
      descriptors: []
    }, {
      id: survivorPageId,
      title: 'HTTP Survivor',
      path: 'pages/http-survivor.json',
      categories: [],
      descriptors: []
    }]
  });
  await writeJson(path.join(vaultRoot, 'navigation.json'), {
    version: 2,
    folders: [],
    items: [pageId, survivorPageId]
  });
  await writeJson(pagePath, {
    id: pageId,
    title: 'HTTP Test',
    categories: [],
    descriptors: [],
    objects: [{
      id: 'object_stable',
      type: 'image',
      displayable: true,
      originalName: 'A.png',
      mimeType: 'image/png',
      location: { type: 'workspace', workspaceId: 'workspace_lab', relativePath: 'A.png' },
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      visible: true
    }],
    maintenanceResources: [],
    blocks: [],
    backlinks: [],
    highlightGroups: []
  });
  await writeJson(survivorPagePath, {
    id: survivorPageId,
    title: 'HTTP Survivor',
    categories: [],
    descriptors: [],
    objects: [],
    maintenanceResources: [{
      id: 'resource_shared_vault_image',
      type: 'file',
      displayable: false,
      location: { type: 'vault', relativePath: 'assets/images/shared-page-object.png' }
    }],
    blocks: [],
    backlinks: [],
    highlightGroups: []
  });

  process.env.VIEWER_ROOT = vaultRoot;
  process.env.VIEWER_APP_ROOT = path.resolve(__dirname, '..');
  const { resolveResourceLocation } = require('../desktop/vaultPaths');
  const { startServer } = require('../server/appServer');
  const resolveLocation = (location) => resolveResourceLocation(vaultRoot, location, {
    workspaceDefinitions: {
      version: 1,
      workspaces: { workspace_lab: { id: 'workspace_lab', label: 'Lab' } }
    },
    workspaceRoots: { workspace_lab: workspaceRoot },
    folderRegistry: {
      version: 1,
      folders: [{ id: 'folder_001', name: 'Resources' }, {
        id: 'folder_002', name: 'External Resources'
      }],
      defaultFolderId: 'folder_001'
    },
    folderRoots: { folder_001: folderRoot, folder_002: externalFolderRoot }
  });
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    resourceResolver: resolveLocation,
    desktopMutationToken: token
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const contentUrl = `${origin}/api/pages/${pageId}/resources/object_stable/content`;

  const first = await fetch(contentUrl);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'image/png');
  assert.equal(first.headers.get('cache-control'), 'no-cache');
  assert.equal(await first.text(), 'first-image');
  const firstEtag = first.headers.get('etag');
  assert.ok(firstEtag);

  const fresh = await fetch(contentUrl, { headers: { 'if-none-match': firstEtag } });
  assert.equal(fresh.status, 304);

  await fs.writeFile(firstImage, Buffer.from('updated-image-content'));
  const updated = await fetch(contentUrl, { headers: { 'if-none-match': firstEtag } });
  assert.equal(updated.status, 200);
  assert.equal(await updated.text(), 'updated-image-content');
  assert.notEqual(updated.headers.get('etag'), firstEtag);

  const arbitrary = await fetch(`${origin}/api/pages/${pageId}/resources/not_a_path/content`);
  assert.equal(arbitrary.status, 404);
  const unauthorized = await fetch(`${origin}/api/pages/${pageId}/add-files`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files: [] })
  });
  assert.equal(unauthorized.status, 403);

  const linked = await fetch(`${origin}/api/pages/${pageId}/add-files`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-viewer-desktop-token': token
    },
    body: JSON.stringify({
      files: [{
        location: { type: 'workspace', workspaceId: 'workspace_lab', relativePath: 'B.png' }
      }, {
        location: { type: 'workspace', workspaceId: 'workspace_lab', relativePath: 'model.psd' }
      }]
    })
  });
  assert.equal(linked.status, 200);
  const linkedBody = await linked.json();
  const linkedObject = linkedBody.linked[0].item;
  const linkedResource = linkedBody.linked[1].item;
  assert.ok(linkedObject.id);
  assert.equal(linkedObject.location.workspaceId, 'workspace_lab');
  assert.equal(linkedObject.location.relativePath, 'B.png');
  assert.equal(Object.hasOwn(linkedObject, 'src'), false);
  assert.equal(JSON.stringify(linkedObject).includes(workspaceRoot), false);
  assert.equal(linkedResource.displayable, false);
  assert.equal(linkedResource.location.relativePath, 'model.psd');
  assert.equal(JSON.stringify(linkedResource).includes(workspaceRoot), false);
  assert.deepEqual(
    await fs.readdir(path.join(vaultRoot, 'assets/images')),
    ['shared-page-object.png']
  );
  assert.deepEqual(await fs.readdir(path.join(vaultRoot, 'assets/resources')), []);

  await fs.writeFile(path.join(vaultRoot, 'assets/resources/vault-model.txt'), 'vault-resource');
  const vaultManaged = await fetch(`${origin}/api/pages/${pageId}/add-files`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-viewer-desktop-token': token
    },
    body: JSON.stringify({
      files: [{
        location: { type: 'vault', relativePath: 'assets/resources/vault-model.txt' }
      }]
    })
  });
  assert.equal(vaultManaged.status, 200);
  const vaultManagedBody = await vaultManaged.json();
  assert.deepEqual(vaultManagedBody.linked[0].item.location, {
    type: 'vault',
    relativePath: 'assets/resources/vault-model.txt'
  });
  const vaultManagedResource = vaultManagedBody.linked[0].item;

  const added = await fetch(`${origin}/api/pages/${pageId}/add-files`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-viewer-desktop-token': token
    },
    body: JSON.stringify({
      files: [{
        location: { type: 'folder', folderId: 'folder_001', relativePath: 'C.png' }
      }]
    })
  });
  assert.equal(added.status, 200);
  const addedBody = await added.json();
  const folderObject = addedBody.linked[0].item;
  assert.equal(folderObject.location.folderId, 'folder_001');
  assert.equal(folderObject.fileName, 'C.png');
  assert.equal(JSON.stringify(folderObject).includes(folderRoot), false);

  const externalAdded = await fetch(`${origin}/api/pages/${pageId}/add-files`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-viewer-desktop-token': token
    },
    body: JSON.stringify({
      files: [{
        location: { type: 'folder', folderId: 'folder_002', relativePath: 'D.png' }
      }]
    })
  });
  assert.equal(externalAdded.status, 200);
  const externalFolderObject = (await externalAdded.json()).linked[0].item;
  assert.equal(externalFolderObject.location.folderId, 'folder_002');

  const pageWithSharedReference = JSON.parse(await fs.readFile(pagePath, 'utf8'));
  pageWithSharedReference.maintenanceResources.push({
    id: 'resource_same_file',
    type: 'file',
    originalName: 'C.png',
    fileName: 'C.png',
    size: folderObject.size,
    displayable: false,
    location: folderObject.location
  }, {
    id: 'resource_external_same_file',
    type: 'file',
    originalName: 'D.png',
    fileName: 'D.png',
    size: externalFolderObject.size,
    displayable: false,
    location: externalFolderObject.location
  });
  await writeJson(pagePath, pageWithSharedReference);

  const relocatedFolderImage = path.join(folderRoot, 'nested/C.png');
  await fs.mkdir(path.dirname(relocatedFolderImage), { recursive: true });
  await fs.rename(folderImage, relocatedFolderImage);
  const relocation = await fetch(
    `${origin}/api/pages/${pageId}/resources/${encodeURIComponent(folderObject.id)}/location`,
    {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-viewer-desktop-token': token
      },
      body: JSON.stringify({
        previousLocation: folderObject.location,
        nextLocation: { type: 'folder', folderId: 'folder_001', relativePath: 'nested/C.png' }
      })
    }
  );
  assert.equal(relocation.status, 200);
  const relocationBody = await relocation.json();
  const relocatedObject = relocationBody.page.objects.find((item) => item.id === folderObject.id);
  assert.equal(relocatedObject.id, folderObject.id);
  assert.equal(relocatedObject.location.relativePath, 'nested/C.png');
  assert.equal(relocatedObject.width, folderObject.width);
  assert.equal(
    relocationBody.page.maintenanceResources
      .find((item) => item.id === 'resource_same_file').location.relativePath,
    'nested/C.png'
  );
  assert.deepEqual(
    relocationBody.updatedResourceIds.sort(),
    [folderObject.id, 'resource_same_file'].sort()
  );
  assert.equal((await fs.stat(relocatedFolderImage)).isFile(), true);

  const ordinaryVaultObjectPath = path.join(vaultRoot, 'assets/images/ordinary-vault-object.png');
  await fs.writeFile(ordinaryVaultObjectPath, 'ordinary-vault-object');
  const pageWithVaultObject = JSON.parse(await fs.readFile(pagePath, 'utf8'));
  pageWithVaultObject.objects.push({
    id: 'object_ordinary_vault',
    type: 'image',
    displayable: true,
    visible: true,
    location: { type: 'vault', relativePath: 'assets/images/ordinary-vault-object.png' },
    x: 10,
    y: 20,
    width: 100,
    height: 100
  });
  pageWithVaultObject.blocks.push({
    id: 'block_ordinary_vault',
    objectId: 'object_ordinary_vault',
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    links: []
  });
  pageWithVaultObject.highlightGroups.push({
    id: 'group_ordinary_vault',
    name: 'Ordinary Vault',
    blockIds: ['block_ordinary_vault']
  });
  await writeJson(pagePath, pageWithVaultObject);

  async function unlinkResource(itemId) {
    const response = await fetch(
      `${origin}/api/pages/${pageId}/resources/${encodeURIComponent(itemId)}`,
      { method: 'DELETE' }
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(Object.hasOwn(body, 'deletedAsset'), false);
    return body;
  }

  await unlinkResource(linkedObject.id);
  assert.equal((await fs.stat(secondImage)).isFile(), true);
  await unlinkResource(linkedResource.id);
  assert.equal((await fs.stat(modelFile)).isFile(), true);

  await unlinkResource(folderObject.id);
  assert.equal((await fs.stat(relocatedFolderImage)).isFile(), true);
  await unlinkResource('resource_same_file');
  assert.equal((await fs.stat(relocatedFolderImage)).isFile(), true);

  await unlinkResource(externalFolderObject.id);
  assert.equal((await fs.stat(externalFolderImage)).isFile(), true);
  await unlinkResource('resource_external_same_file');
  assert.equal((await fs.stat(externalFolderImage)).isFile(), true);

  await unlinkResource(vaultManagedResource.id);
  assert.equal(
    await fs.readFile(path.join(vaultRoot, 'assets/resources/vault-model.txt'), 'utf8'),
    'vault-resource'
  );
  const vaultObjectUnlink = await unlinkResource('object_ordinary_vault');
  assert.equal(vaultObjectUnlink.removedBlockCount, 1);
  assert.equal(await fs.readFile(ordinaryVaultObjectPath, 'utf8'), 'ordinary-vault-object');
  assert.equal(
    vaultObjectUnlink.page.highlightGroups.some((group) => group.id === 'group_ordinary_vault'),
    false
  );

  const pageOwnedObjectPath = path.join(vaultRoot, 'assets/images/page-delete-object.png');
  const pageOwnedMaintenancePath = path.join(
    vaultRoot,
    'assets/resources/page-delete-maintenance.bin'
  );
  await fs.writeFile(pageOwnedObjectPath, 'page-owned-object');
  await fs.writeFile(pageOwnedMaintenancePath, 'page-owned-maintenance');
  const pageForDeletion = JSON.parse(await fs.readFile(pagePath, 'utf8'));
  pageForDeletion.objects.push({
    id: 'object_page_destruction',
    type: 'image',
    displayable: true,
    visible: true,
    location: { type: 'vault', relativePath: 'assets/images/page-delete-object.png' },
    x: 0,
    y: 0,
    width: 100,
    height: 100
  }, {
    id: 'object_page_shared',
    type: 'image',
    displayable: true,
    visible: true,
    location: { type: 'vault', relativePath: 'assets/images/shared-page-object.png' },
    x: 100,
    y: 100,
    width: 100,
    height: 100
  });
  pageForDeletion.maintenanceResources.push({
    id: 'resource_page_destruction',
    type: 'file',
    displayable: false,
    location: {
      type: 'vault',
      relativePath: 'assets/resources/page-delete-maintenance.bin'
    }
  });
  pageForDeletion.blocks.push({
    id: 'block_page_destruction',
    objectId: 'object_page_destruction',
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    links: []
  });
  pageForDeletion.highlightGroups.push({
    id: 'group_page_destruction',
    name: 'Page destruction',
    blockIds: ['block_page_destruction']
  });
  await writeJson(pagePath, pageForDeletion);

  const pageDeletion = await fetch(`${origin}/api/pages/${pageId}`, { method: 'DELETE' });
  assert.equal(pageDeletion.status, 200);
  const pageDeletionBody = await pageDeletion.json();
  assert.deepEqual(pageDeletionBody.resourceUnlinks, {
    objects: 3,
    maintenanceResources: 1,
    blocks: 1
  });
  assert.deepEqual(pageDeletionBody.deletedAssets, ['assets/images/page-delete-object.png']);
  await assert.rejects(fs.access(pagePath), { code: 'ENOENT' });
  await assert.rejects(fs.access(pageOwnedObjectPath), { code: 'ENOENT' });
  assert.equal(await fs.readFile(sharedVaultImage, 'utf8'), 'shared-vault-image');
  assert.equal(await fs.readFile(pageOwnedMaintenancePath, 'utf8'), 'page-owned-maintenance');
  assert.equal((await fs.stat(firstImage)).isFile(), true);
  assert.equal((await fs.stat(relocatedFolderImage)).isFile(), true);
  assert.equal((await fs.stat(externalFolderImage)).isFile(), true);
  assert.equal((await fs.stat(survivorPagePath)).isFile(), true);
});
