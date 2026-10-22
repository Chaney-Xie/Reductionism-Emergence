const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createNavigationModel } = require('../server/navigationModel');

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function manualFolder(id, pageIds = [], children = []) {
  return {
    id,
    label: id,
    type: 'manual',
    collapsed: false,
    source: { kind: 'manual', pageIds },
    children
  };
}

test('navigation batch HTTP move persists once without touching page or project JSON', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-navigation-batch-http-'));
  const pageIds = ['page_1', 'page_2', 'page_3'];
  const index = {
    pages: pageIds.map((id) => ({
      id,
      title: id,
      path: `pages/${id}.json`,
      categories: ['category_1'],
      descriptors: []
    }))
  };
  const model = createNavigationModel({
    pagesDir: path.join(vaultRoot, 'pages'),
    pageDateStamp: () => '20260717'
  });
  const navigation = model.normalizeNavigation({
    version: 2,
    folders: [
      manualFolder('folder_source', ['page_1', 'page_2']),
      manualFolder('folder_target', ['page_3'])
    ],
    items: []
  }, index);
  const project = {
    projectId: 'project_navigation_batch',
    projectName: 'Navigation Batch',
    version: '0.2.2',
    lastOpenedPageId: 'page_1'
  };
  await writeJson(path.join(vaultRoot, 'vault.json'), project);
  await writeJson(path.join(vaultRoot, 'pageIndex.json'), index);
  await writeJson(path.join(vaultRoot, 'navigation.json'), navigation);
  await fs.mkdir(path.join(vaultRoot, 'assets/images'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, 'assets/resources'), { recursive: true });
  const pagePaths = [];
  for (const pageId of pageIds) {
    const pagePath = path.join(vaultRoot, `pages/${pageId}.json`);
    pagePaths.push(pagePath);
    await writeJson(pagePath, {
      id: pageId,
      title: pageId,
      categories: ['category_1'],
      descriptors: { class_1: ['descriptor_1'] },
      objects: [],
      maintenanceResources: [],
      blocks: [{ id: `block_${pageId}`, links: [] }],
      backlinks: []
    });
  }
  const pageBytesBefore = await Promise.all(pagePaths.map((filePath) => fs.readFile(filePath, 'utf8')));
  const projectBefore = await fs.readFile(path.join(vaultRoot, 'vault.json'), 'utf8');

  process.env.VIEWER_ROOT = vaultRoot;
  process.env.VIEWER_APP_ROOT = path.resolve(__dirname, '..');
  const { startServer } = require('../server/appServer');
  const server = await startServer({ host: '127.0.0.1', port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${origin}/api/navigation/move`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: [
        { type: 'page', id: 'page_2' },
        { type: 'page', id: 'page_1' }
      ],
      destination: { parentFolderId: 'folder_target' }
    })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.movedItems.map((item) => item.id), ['page_1', 'page_2']);
  assert.deepEqual(
    model.findFolderLocation(body.navigation.folders, 'folder_target').folder.source.pageIds,
    ['page_3', 'page_1', 'page_2']
  );
  assert.equal(body.navigation.version, 3);
  assert.deepEqual(body.navigation.bindings, []);
  assert.deepEqual(await Promise.all(pagePaths.map((filePath) => fs.readFile(filePath, 'utf8'))), pageBytesBefore);
  assert.equal(await fs.readFile(path.join(vaultRoot, 'vault.json'), 'utf8'), projectBefore);

  const beforeStationary = await fs.readFile(path.join(vaultRoot, 'navigation.json'), 'utf8');
  const stationary = await fetch(`${origin}/api/navigation/move`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: [{ type: 'page', id: 'page_1' }],
      destination: { parentFolderId: 'folder_target' }
    })
  });
  assert.equal(stationary.status, 200);
  const stationaryBody = await stationary.json();
  assert.equal(stationaryBody.changed, false);
  assert.deepEqual(stationaryBody.movedItems, []);
  assert.equal(
    await fs.readFile(path.join(vaultRoot, 'navigation.json'), 'utf8'),
    beforeStationary,
    'a same-container membership drop performs no persistence write'
  );

  const beforeInvalid = await fs.readFile(path.join(vaultRoot, 'navigation.json'), 'utf8');
  const invalid = await fetch(`${origin}/api/navigation/move`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: [
        { type: 'folder', id: 'folder_target' },
        { type: 'page', id: 'page_1' }
      ],
      destination: { parentFolderId: 'folder_target' }
    })
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /itself/);
  assert.equal(await fs.readFile(path.join(vaultRoot, 'navigation.json'), 'utf8'), beforeInvalid);
});
