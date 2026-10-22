const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function manualFolder(id, pageIds) {
  return {
    id,
    label: id,
    type: 'manual',
    collapsed: false,
    source: { kind: 'manual', pageIds },
    children: []
  };
}

test('default and Stick on top mutations stay in navigation and survive atomic movement', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-navigation-organisation-'));
  const pageIds = ['page_1', 'page_2', 'page_3'];
  const pageIndex = {
    pages: pageIds.map((id) => ({
      id,
      title: id,
      path: `pages/${id}.json`,
      categories: [],
      descriptors: []
    }))
  };
  const navigation = {
    version: 2,
    folders: [
      manualFolder('folder_source', ['page_1', 'page_2']),
      manualFolder('folder_target', ['page_3'])
    ],
    items: []
  };
  await writeJson(path.join(vaultRoot, 'vault.json'), {
    projectId: 'project_navigation_organisation',
    projectName: 'Navigation Organisation',
    version: '0.2.2',
    lastOpenedPageId: 'page_1'
  });
  await writeJson(path.join(vaultRoot, 'pageIndex.json'), pageIndex);
  await writeJson(path.join(vaultRoot, 'navigation.json'), navigation);
  await fs.mkdir(path.join(vaultRoot, 'assets/images'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, 'assets/resources'), { recursive: true });
  const pagePaths = [];
  for (const pageId of pageIds) {
    const filePath = path.join(vaultRoot, `pages/${pageId}.json`);
    pagePaths.push(filePath);
    await writeJson(filePath, {
      id: pageId,
      title: pageId,
      categories: [],
      descriptors: {},
      objects: [],
      maintenanceResources: [],
      blocks: [],
      backlinks: []
    });
  }
  const pageBytes = await Promise.all(pagePaths.map((filePath) => fs.readFile(filePath, 'utf8')));

  process.env.VIEWER_ROOT = vaultRoot;
  process.env.VIEWER_APP_ROOT = path.resolve(__dirname, '..');
  const { startServer } = require('../server/appServer');
  const server = await startServer({ host: '127.0.0.1', port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const nestedFolderResponse = await fetch(`${origin}/api/navigation/folders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parentFolderId: 'folder_source' })
  });
  assert.equal(nestedFolderResponse.status, 201);
  const nestedFolderCreated = await nestedFolderResponse.json();
  const sourceWithNestedFolder = nestedFolderCreated.navigation.folders
    .find((folder) => folder.id === 'folder_source');
  assert.equal(sourceWithNestedFolder.children[0].id, nestedFolderCreated.folder.id);
  assert.equal(sourceWithNestedFolder.collapsed, false);

  const nestedPageResponse = await fetch(`${origin}/api/pages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parentFolderId: 'folder_source' })
  });
  assert.equal(nestedPageResponse.status, 201);
  const nestedPageCreated = await nestedPageResponse.json();
  const nestedPageId = nestedPageCreated.page.id;
  const sourceWithNestedPage = nestedPageCreated.navigation.folders
    .find((folder) => folder.id === 'folder_source');
  assert.equal(sourceWithNestedPage.source.pageIds.includes(nestedPageId), true);
  assert.equal(nestedPageCreated.navigation.items.includes(nestedPageId), false);
  assert.equal(sourceWithNestedPage.collapsed, false);

  const systemFolderCreate = await fetch(`${origin}/api/pages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parentFolderId: 'folder_uncategorised' })
  });
  assert.equal(systemFolderCreate.status, 400);

  async function patch(url, body) {
    const response = await fetch(`${origin}${url}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 200);
    return response.json();
  }

  let result = await patch('/api/navigation/folders/folder_source/default-page', { pageId: 'page_1' });
  assert.equal(result.defaultPageId, 'page_1');
  result = await patch('/api/navigation/folders/folder_source/default-page', { pageId: 'page_2' });
  assert.equal(result.defaultPageId, 'page_2');
  assert.equal(result.navigation.folders.find((folder) => folder.id === 'folder_source').defaultPageId, 'page_2');
  result = await patch('/api/navigation/folders/folder_source/default-page', { pageId: null });
  assert.equal(result.defaultPageId, null);

  result = await patch('/api/navigation/pages/page_1/stick-on-top', { enabled: true });
  assert.deepEqual(result.navigation.pageStates.page_1, { stickOnTop: true });
  result = await patch('/api/navigation/pages/page_1/stick-on-top', { enabled: false });
  assert.equal(Object.hasOwn(result.navigation.pageStates, 'page_1'), false);
  result = await patch('/api/navigation/pages/page_1/stick-on-top', { enabled: true });
  result = await patch('/api/navigation/folders/folder_source/stick-on-top', { enabled: true });
  assert.equal(result.navigation.folders.find((folder) => folder.id === 'folder_source').stickOnTop, true);
  result = await patch('/api/navigation/folders/folder_source/stick-on-top', { enabled: false });
  assert.equal(result.navigation.folders.find((folder) => folder.id === 'folder_source').stickOnTop, false);
  result = await patch('/api/navigation/folders/folder_source/stick-on-top', { enabled: true });
  await patch('/api/navigation/folders/folder_source/default-page', { pageId: 'page_1' });

  const moveResponse = await fetch(`${origin}/api/navigation/move`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: [{ type: 'page', id: 'page_1' }],
      destination: { parentFolderId: 'folder_target' }
    })
  });
  assert.equal(moveResponse.status, 200);
  const moved = await moveResponse.json();
  assert.equal(moved.navigation.folders.find((folder) => folder.id === 'folder_source').defaultPageId, null);
  assert.equal(moved.navigation.folders.find((folder) => folder.id === 'folder_target').source.pageIds.includes('page_1'), true);
  assert.deepEqual(moved.navigation.pageStates.page_1, { stickOnTop: true });
  assert.equal(moved.navigation.folders.find((folder) => folder.id === 'folder_source').stickOnTop, true);
  assert.deepEqual(await Promise.all(pagePaths.map((filePath) => fs.readFile(filePath, 'utf8'))), pageBytes);

  const invalidDefault = await fetch(`${origin}/api/navigation/folders/folder_source/default-page`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pageId: 'page_1' })
  });
  assert.equal(invalidDefault.status, 400);

  await patch('/api/navigation/folders/folder_target/default-page', { pageId: 'page_1' });
  const deleteResponse = await fetch(`${origin}/api/pages/page_1`, { method: 'DELETE' });
  assert.equal(deleteResponse.status, 200);
  const deleted = await deleteResponse.json();
  const targetAfterDelete = deleted.navigation.folders.find((folder) => folder.id === 'folder_target');
  assert.equal(targetAfterDelete.defaultPageId, null);
  assert.equal(Object.hasOwn(deleted.navigation.pageStates, 'page_1'), false);
  assert.deepEqual(
    deleted.pageIndex.pages.map((page) => page.id),
    ['page_2', 'page_3', nestedPageId]
  );
  assert.equal((await fs.readFile(pagePaths[1], 'utf8')), pageBytes[1]);
  assert.equal((await fs.readFile(pagePaths[2], 'utf8')), pageBytes[2]);
});
