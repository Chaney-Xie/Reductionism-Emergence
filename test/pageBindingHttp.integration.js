const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function manualFolder(id, pageIds = []) {
  return {
    id,
    label: id,
    type: 'manual',
    collapsed: false,
    defaultPageId: null,
    source: { kind: 'manual', pageIds },
    children: []
  };
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function jsonRequest(origin, pathname, { method = 'GET', body } = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    method,
    ...(body === undefined ? {} : {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  });
  return { response, body: await response.json() };
}

test('Binding HTTP mutations own placement, guard legacy routes, and clean up Page deletion', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-page-binding-http-'));
  const pageIds = ['page_a', 'page_b', 'page_c', 'page_d', 'page_e', 'page_dynamic'];
  const pageIndex = {
    pages: pageIds.map((id) => ({
      id,
      title: id,
      path: `pages/${id}.json`,
      categories: id === 'page_dynamic' ? ['category_dynamic'] : [],
      descriptors: []
    }))
  };
  await writeJson(path.join(vaultRoot, 'vault.json'), {
    projectId: 'project_page_binding_http',
    projectName: 'Page Binding HTTP',
    version: '0.2.2',
    lastOpenedPageId: 'page_a'
  });
  await writeJson(path.join(vaultRoot, 'pageIndex.json'), pageIndex);
  await writeJson(path.join(vaultRoot, 'navigation.json'), {
    version: 2,
    folders: [
      manualFolder('folder_source', ['page_a', 'page_b', 'page_c']),
      manualFolder('folder_other', ['page_d'])
    ],
    items: ['page_e', 'page_dynamic'],
    pageStates: {},
    bindings: [{
      id: 'binding_stale',
      leaderPageId: 'page_missing',
      followerPageIds: ['page_b']
    }]
  });
  await writeJson(path.join(vaultRoot, 'categories.json'), {
    navigation: {
      enabledCategoryIds: ['category_dynamic'],
      collapseUncategorisedPages: false,
      quantityStatistics: false
    },
    groups: [{
      id: 'category_group',
      label: 'Categories',
      children: [{ type: 'item', id: 'category_dynamic', label: 'Dynamic' }]
    }]
  });
  await fs.mkdir(path.join(vaultRoot, 'assets/images'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, 'assets/resources'), { recursive: true });
  for (const pageId of pageIds) {
    await writeJson(path.join(vaultRoot, `pages/${pageId}.json`), {
      id: pageId,
      title: pageId,
      categories: pageId === 'page_dynamic' ? ['category_dynamic'] : [],
      descriptors: {},
      objects: [],
      maintenanceResources: [],
      blocks: pageId === 'page_e' ? [{
        id: 'block_source', objectId: 'object_missing', x: 0, y: 0,
        width: 10, height: 10, links: []
      }] : [],
      backlinks: []
    });
  }

  process.env.VIEWER_ROOT = vaultRoot;
  process.env.VIEWER_APP_ROOT = path.resolve(__dirname, '..');
  const { startServer } = require('../server/appServer');
  let server = await startServer({ host: '127.0.0.1', port: 0 });
  t.after(() => closeServer(server));
  let origin = `http://127.0.0.1:${server.address().port}`;

  let result = await jsonRequest(origin, '/api/navigation');
  assert.equal(result.response.status, 200);
  assert.equal(result.body.version, 3);
  assert.deepEqual(result.body.bindings, []);

  result = await jsonRequest(origin, '/api/navigation/folders/folder_other/move', {
    method: 'POST', body: { itemType: 'page', pageId: 'page_e' }
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(
    result.body.navigation.folders.find((folder) => folder.id === 'folder_other').source.pageIds,
    ['page_d', 'page_e']
  );
  result = await jsonRequest(origin, '/api/navigation/root/move', {
    method: 'POST', body: { itemType: 'page', pageId: 'page_e', rootIndex: 0 }
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.navigation.items[0], 'page_e');
  result = await jsonRequest(origin, '/api/navigation/insert', {
    method: 'POST',
    body: { itemType: 'page', pageId: 'page_e', parentFolderId: 'folder_source', index: 1 }
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(
    result.body.navigation.folders.find((folder) => folder.id === 'folder_source').source.pageIds,
    ['page_a', 'page_e', 'page_b', 'page_c']
  );
  result = await jsonRequest(origin, '/api/navigation/insert', {
    method: 'POST', body: { itemType: 'page', pageId: 'page_e', parentFolderId: null, index: 0 }
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.navigation.items[0], 'page_e');

  const navigationBytesBeforeInvalidBinding = await fs.readFile(
    path.join(vaultRoot, 'navigation.json'), 'utf8'
  );
  const dynamicTarget = await jsonRequest(origin, '/api/navigation/bindings', {
    method: 'POST',
    body: { selectedPageIds: ['page_e'], leaderPageId: 'page_dynamic' }
  });
  assert.equal(dynamicTarget.response.status, 400);
  assert.deepEqual((await jsonRequest(origin, '/api/navigation')).body.bindings, []);
  assert.equal(
    await fs.readFile(path.join(vaultRoot, 'navigation.json'), 'utf8'),
    navigationBytesBeforeInvalidBinding
  );

  const pageIndexBytesBeforeBinding = await fs.readFile(path.join(vaultRoot, 'pageIndex.json'));
  const followerBytesBeforeBinding = await fs.readFile(path.join(vaultRoot, 'pages/page_b.json'));
  result = await jsonRequest(origin, '/api/navigation/bindings', {
    method: 'POST',
    body: { selectedPageIds: ['page_b', 'page_c'], leaderPageId: 'page_a' }
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.navigation.bindings.length, 1);
  assert.equal(result.body.navigation.bindings[0].leaderPageId, 'page_a');
  assert.deepEqual(new Set(result.body.navigation.bindings[0].followerPageIds), new Set(['page_b', 'page_c']));
  assert.deepEqual(
    result.body.navigation.folders.find((folder) => folder.id === 'folder_source').source.pageIds,
    ['page_a']
  );
  const initialBindingId = result.body.navigation.bindings[0].id;
  assert.deepEqual(await fs.readFile(path.join(vaultRoot, 'pageIndex.json')), pageIndexBytesBeforeBinding);
  assert.deepEqual(await fs.readFile(path.join(vaultRoot, 'pages/page_b.json')), followerBytesBeforeBinding);

  result = await jsonRequest(origin, '/api/navigation/bindings', {
    method: 'POST',
    body: { selectedPageIds: ['page_d'], leaderPageId: 'page_a' }
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(
    new Set(result.body.navigation.bindings[0].followerPageIds),
    new Set(['page_b', 'page_c', 'page_d'])
  );
  assert.deepEqual(
    result.body.navigation.folders.find((folder) => folder.id === 'folder_other').source.pageIds,
    []
  );

  const createdPage = await jsonRequest(origin, '/api/pages', {
    method: 'POST', body: {}
  });
  assert.equal(createdPage.response.status, 201);
  assert.equal(createdPage.body.navigation.version, 3);
  assert.equal(createdPage.body.navigation.bindings[0].id, initialBindingId);
  const linkedNewPage = await jsonRequest(
    origin,
    '/api/pages/page_e/blocks/block_source/new-page-link',
    { method: 'POST', body: {} }
  );
  assert.equal(linkedNewPage.response.status, 201);
  assert.equal(linkedNewPage.body.navigation.version, 3);
  assert.equal(linkedNewPage.body.navigation.bindings[0].id, initialBindingId);
  const renamedLeader = await jsonRequest(origin, '/api/pages/page_a', {
    method: 'POST', body: { title: 'Renamed Leader' }
  });
  assert.equal(renamedLeader.response.status, 200);
  assert.equal(renamedLeader.body.page.id, 'page_a');
  const categoryRefresh = await jsonRequest(origin, '/api/categories/navigation', {
    method: 'PATCH',
    body: { enabledCategoryIds: ['category_dynamic'] }
  });
  assert.equal(categoryRefresh.response.status, 200);
  assert.equal(categoryRefresh.body.navigation.bindings[0].leaderPageId, 'page_a');

  const blockedMoves = [
    ['/api/navigation/move', {
      items: [{ type: 'page', id: 'page_b' }],
      destination: { parentFolderId: 'folder_other' }
    }],
    ['/api/navigation/folders/folder_other/move', {
      itemType: 'page', pageId: 'page_b'
    }],
    ['/api/navigation/root/move', {
      itemType: 'page', pageId: 'page_b', rootIndex: 0
    }],
    ['/api/navigation/insert', {
      itemType: 'page', pageId: 'page_b', parentFolderId: 'folder_other', index: 0
    }]
  ];
  const navigationBytesBeforeBlockedMoves = await fs.readFile(
    path.join(vaultRoot, 'navigation.json'),
    'utf8'
  );
  for (const [pathname, body] of blockedMoves) {
    const blocked = await jsonRequest(origin, pathname, { method: 'POST', body });
    assert.equal(blocked.response.status, 400, `${pathname} must reject a bound Follower`);
    assert.match(blocked.body.error, /bound|follower/i);
  }
  assert.equal(
    await fs.readFile(path.join(vaultRoot, 'navigation.json'), 'utf8'),
    navigationBytesBeforeBlockedMoves
  );

  result = await jsonRequest(origin, '/api/navigation/folders/folder_source', {
    method: 'DELETE'
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.releasedPageIds, ['page_a']);
  assert.equal(result.body.navigation.bindings[0].leaderPageId, 'page_a');
  assert.equal(result.body.navigation.items.includes('page_a'), true);
  assert.equal(result.body.navigation.items.includes('page_b'), false);
  assert.equal(result.body.navigation.items.includes('page_c'), false);

  result = await jsonRequest(origin, '/api/navigation/bindings/set-leader', {
    method: 'POST', body: { followerPageId: 'page_b' }
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.navigation.bindings[0].leaderPageId, 'page_b');
  assert.equal(result.body.navigation.items.includes('page_b'), true);
  assert.equal(result.body.navigation.items.includes('page_a'), false);

  result = await jsonRequest(origin, '/api/navigation/bindings/stop', {
    method: 'POST', body: { followerPageId: 'page_c' }
  });
  assert.equal(result.response.status, 200);
  assert.equal(
    result.body.navigation.items.indexOf('page_c'),
    result.body.navigation.items.indexOf('page_b') + 1
  );
  assert.equal(result.body.navigation.bindings[0].followerPageIds.includes('page_c'), false);

  result = await jsonRequest(origin, '/api/navigation/move', {
    method: 'POST',
    body: {
      items: [{ type: 'page', id: 'page_b' }],
      destination: { parentFolderId: 'folder_other' }
    }
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(
    result.body.navigation.folders.find((folder) => folder.id === 'folder_other').source.pageIds,
    ['page_b']
  );

  result = await jsonRequest(origin, '/api/pages/page_d', { method: 'DELETE' });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.deletedPageId, 'page_d');
  assert.equal(result.body.navigation.bindings[0].leaderPageId, 'page_b');
  assert.deepEqual(result.body.navigation.bindings[0].followerPageIds, ['page_a']);
  assert.equal(result.body.pageIndex.pages.some((page) => page.id === 'page_a'), true);

  result = await jsonRequest(origin, '/api/pages/page_b', { method: 'DELETE' });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.deletedPageId, 'page_b');
  assert.deepEqual(result.body.navigation.bindings, []);
  assert.deepEqual(
    result.body.navigation.folders.find((folder) => folder.id === 'folder_other').source.pageIds,
    ['page_a']
  );
  assert.equal(result.body.pageIndex.pages.some((page) => page.id === 'page_a'), true);
  assert.equal(await fs.readFile(path.join(vaultRoot, 'pages/page_a.json'), 'utf8').then(Boolean), true);

  result = await jsonRequest(origin, '/api/navigation/bindings', {
    method: 'POST',
    body: { selectedPageIds: ['page_c'], leaderPageId: 'page_e' }
  });
  assert.equal(result.response.status, 200);
  const bindingId = result.body.navigation.bindings[0].id;
  result = await jsonRequest(origin, `/api/navigation/bindings/${bindingId}`, {
    method: 'DELETE'
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.navigation.bindings, []);
  assert.equal(
    result.body.navigation.items.indexOf('page_c'),
    result.body.navigation.items.indexOf('page_e') + 1
  );

  await closeServer(server);
  server = await startServer({ host: '127.0.0.1', port: 0 });
  origin = `http://127.0.0.1:${server.address().port}`;
  result = await jsonRequest(origin, '/api/navigation');
  assert.equal(result.response.status, 200);
  assert.equal(result.body.version, 3);
  assert.deepEqual(result.body.bindings, []);
  assert.deepEqual(
    result.body.folders.find((folder) => folder.id === 'folder_other').source.pageIds,
    ['page_a']
  );
});
