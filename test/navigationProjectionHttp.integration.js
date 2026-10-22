const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function requestJson(origin, pathname, { method = 'GET', body } = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    method,
    ...(body === undefined ? {} : {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  });
  const text = await response.text();
  let value;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    value = { unparsedBody: text };
  }
  return { response, body: value };
}

async function fileSnapshot(filePath) {
  const [bytes, stat] = await Promise.all([
    fs.readFile(filePath, 'utf8'),
    fs.stat(filePath, { bigint: true })
  ]);
  return { bytes, mtimeNs: stat.mtimeNs };
}

function assertSuccessful(result, status = 200) {
  assert.equal(result.response.status, status, result.body?.error || result.body?.unparsedBody);
}

function folderByCategory(navigation, categoryId) {
  return (navigation.folders || []).find((folder) => (
    ['categoryAny', 'categoryAll'].includes(folder?.source?.kind)
      && Array.isArray(folder.source.categoryIds)
      && folder.source.categoryIds.length === 1
      && folder.source.categoryIds[0] === categoryId
  ));
}

function uncategoryFolder(navigation) {
  return (navigation.folders || []).find((folder) => (
    folder?.id === 'folder_uncategorised' || folder?.source?.kind === 'missingCategories'
  ));
}

function pageEntry(id, title, categories) {
  return {
    id,
    title,
    type: 'canvas',
    path: `pages/${id}.json`,
    categories,
    categoryIds: categories,
    descriptors: {},
    descriptorIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

function pageRecord(id, title, categories) {
  return {
    id,
    title,
    type: 'canvas',
    categories,
    descriptors: {},
    ignoredDescriptors: {},
    ignoredManualEntryIds: [],
    objects: [],
    maintenanceResources: [],
    blocks: [],
    backlinks: [],
    highlightGroups: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

test('NavigationProjection migrates once, keeps reads pure, and materializes every Page mutation', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-navigation-projection-http-'));
  const navigationPath = path.join(vaultRoot, 'navigation.json');
  const categoryPath = path.join(vaultRoot, 'categories.json');
  const pageIndexPath = path.join(vaultRoot, 'pageIndex.json');
  const vaultPath = path.join(vaultRoot, 'vault.json');
  const workspaceStatePath = path.join(vaultRoot, 'workspaceState.json');
  const pages = [
    pageEntry('page_x', 'Page X', ['category_x']),
    pageEntry('page_y', 'Page Y', ['category_y']),
    pageEntry('page_manual', 'Manual Page', []),
    pageEntry('page_leader', 'Binding Leader', []),
    pageEntry('page_follower', 'Binding Follower', []),
    pageEntry('page_free', 'Free Root Page', [])
  ];

  await writeJson(vaultPath, {
    vaultId: 'vault_navigation_projection',
    displayName: 'Navigation Projection',
    schemaVersion: 1,
    sourceVersion: '0.2.2',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  });
  await writeJson(workspaceStatePath, {
    schemaVersion: 1,
    lastOpenedPageId: 'page_x',
    workspaceState: null
  });
  await writeJson(categoryPath, {
    navigation: {
      enabledCategoryIds: ['category_x', 'category_y'],
      collapseUncategorisedPages: false,
      quantityStatistics: true
    },
    groups: [{
      id: 'category_group',
      label: 'Categories',
      children: [
        { type: 'item', id: 'category_x', label: 'Category X' },
        { type: 'item', id: 'category_y', label: 'Category Y' }
      ]
    }]
  });
  await writeJson(pageIndexPath, { pages });
  await writeJson(navigationPath, {
    version: 3,
    folders: [{
      id: 'folder_uncategorised',
      label: 'Uncategory',
      type: 'system',
      pinned: true,
      collapsed: true,
      excludeFromRoot: false,
      source: { kind: 'missingCategories' },
      children: []
    }, {
      id: 'folder_x_stable',
      label: 'Category X',
      type: 'system',
      pinned: true,
      collapsed: false,
      excludeFromRoot: true,
      source: { kind: 'categoryAny', categoryIds: ['category_x'] },
      projectedPageIds: ['page_free'],
      children: []
    }, {
      id: 'folder_manual_preserved',
      label: 'Manual Preserved',
      type: 'manual',
      pinned: false,
      collapsed: true,
      defaultPageId: 'page_manual',
      stickOnTop: true,
      pinnedPageIds: ['page_manual'],
      pageOrder: ['page_manual'],
      source: { kind: 'manual', pageIds: ['page_manual'] },
      children: []
    }],
    items: ['page_x', 'page_free', 'page_y', 'page_leader'],
    pageStates: { page_leader: { rootPlacement: true } },
    bindings: [{
      id: 'binding_preserved',
      leaderPageId: 'page_leader',
      followerPageIds: ['page_follower']
    }]
  });
  for (const page of pages) {
    await writeJson(
      path.join(vaultRoot, page.path),
      pageRecord(page.id, page.title, page.categories)
    );
  }
  await fs.mkdir(path.join(vaultRoot, 'assets/images'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, 'assets/resources'), { recursive: true });

  process.env.VIEWER_ROOT = vaultRoot;
  process.env.VIEWER_APP_ROOT = path.resolve(__dirname, '..');
  const { startServer } = require('../server/appServer');
  let server = await startServer({ host: '127.0.0.1', port: 0 });
  let origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => closeServer(server));

  await t.test('legacy navigation receives one materialized migration and restart is byte-idempotent', async () => {
    const migrated = JSON.parse(await fs.readFile(navigationPath, 'utf8'));
    assert.equal(migrated.dynamicProjection.version, 1);
    assert.deepEqual(folderByCategory(migrated, 'category_x').projectedPageIds, ['page_x']);
    assert.deepEqual(folderByCategory(migrated, 'category_y').projectedPageIds, ['page_y']);
    assert.deepEqual(
      uncategoryFolder(migrated).projectedPageIds,
      ['page_manual', 'page_leader', 'page_follower', 'page_free']
    );
    assert.deepEqual(migrated.items, ['page_free', 'page_leader'],
      'migration repairs stale membership without changing canonical root order');
    assert.equal(folderByCategory(migrated, 'category_x').id, 'folder_x_stable');
    assert.equal(folderByCategory(migrated, 'category_x').collapsed, false);
    assert.equal(
      migrated.folders.find((folder) => folder.id === 'folder_manual_preserved').collapsed,
      true
    );
    assert.deepEqual(migrated.bindings, [{
      id: 'binding_preserved',
      leaderPageId: 'page_leader',
      followerPageIds: ['page_follower']
    }]);

    const afterMigration = await fileSnapshot(navigationPath);
    await closeServer(server);
    await new Promise((resolve) => setTimeout(resolve, 25));
    server = await startServer({ host: '127.0.0.1', port: 0 });
    origin = `http://127.0.0.1:${server.address().port}`;
    const afterRestart = await fileSnapshot(navigationPath);
    assert.equal(afterRestart.bytes, afterMigration.bytes);
    assert.equal(afterRestart.mtimeNs, afterMigration.mtimeNs);
  });

  await t.test('ordinary navigation GETs return stored navigation without changing bytes or mtime', async () => {
    const before = await fileSnapshot(navigationPath);
    const stored = JSON.parse(before.bytes);
    for (let index = 0; index < 5; index += 1) {
      const result = await requestJson(origin, '/api/navigation');
      assertSuccessful(result);
      assert.deepEqual(result.body, stored);
    }
    const [categoryBytes, pageIndexBytes] = await Promise.all([
      fs.readFile(categoryPath, 'utf8'),
      fs.readFile(pageIndexPath, 'utf8')
    ]);
    let isolatedRead;
    try {
      await Promise.all([
        fs.writeFile(categoryPath, '{ navigation GET must not read categories', 'utf8'),
        fs.writeFile(pageIndexPath, '{ navigation GET must not read pageIndex', 'utf8')
      ]);
      isolatedRead = await requestJson(origin, '/api/navigation');
    } finally {
      await Promise.all([
        fs.writeFile(categoryPath, categoryBytes, 'utf8'),
        fs.writeFile(pageIndexPath, pageIndexBytes, 'utf8')
      ]);
    }
    assertSuccessful(isolatedRead);
    assert.deepEqual(isolatedRead.body, stored);
    const after = await fileSnapshot(navigationPath);
    assert.equal(after.bytes, before.bytes);
    assert.equal(after.mtimeNs, before.mtimeNs);
  });

  await t.test('explicit rebuild repairs only derived fields and preserves navigation-owned state', async () => {
    const drifted = JSON.parse(await fs.readFile(navigationPath, 'utf8'));
    folderByCategory(drifted, 'category_x').projectedPageIds = ['page_y', 'page_free'];
    folderByCategory(drifted, 'category_y').projectedPageIds = [];
    uncategoryFolder(drifted).projectedPageIds = [];
    drifted.dynamicProjection.pages.page_x.title = 'Stale projected title';
    const rootOrderBefore = [...drifted.items];
    await writeJson(navigationPath, drifted);

    const canonicalPaths = [
      vaultPath,
      workspaceStatePath,
      categoryPath,
      pageIndexPath,
      ...pages.map((page) => path.join(vaultRoot, page.path))
    ];
    const canonicalBefore = new Map(await Promise.all(canonicalPaths.map(async (filePath) => (
      [filePath, await fs.readFile(filePath, 'utf8')]
    ))));

    const result = await requestJson(origin, '/api/navigation/rebuild', {
      method: 'POST',
      body: {}
    });
    assertSuccessful(result);
    assert.ok(result.body?.navigation, 'rebuild response must return authoritative navigation');
    const rebuilt = result.body.navigation;
    assert.deepEqual(rebuilt, JSON.parse(await fs.readFile(navigationPath, 'utf8')));
    assert.deepEqual(folderByCategory(rebuilt, 'category_x').projectedPageIds, ['page_x']);
    assert.deepEqual(folderByCategory(rebuilt, 'category_y').projectedPageIds, ['page_y']);
    assert.deepEqual(
      uncategoryFolder(rebuilt).projectedPageIds,
      ['page_manual', 'page_leader', 'page_follower', 'page_free']
    );
    assert.deepEqual(rebuilt.items, rootOrderBefore,
      'explicit repair must not reorder canonical root Pages because of stale memberships');
    assert.deepEqual(rebuilt.dynamicProjection.pages.page_x, { id: 'page_x', title: 'Page X' });
    assert.equal(folderByCategory(rebuilt, 'category_x').id, 'folder_x_stable');
    assert.equal(folderByCategory(rebuilt, 'category_x').collapsed, false);
    assert.deepEqual(
      rebuilt.folders.find((folder) => folder.id === 'folder_manual_preserved'),
      drifted.folders.find((folder) => folder.id === 'folder_manual_preserved')
    );
    assert.deepEqual(rebuilt.bindings, drifted.bindings);

    for (const filePath of canonicalPaths) {
      assert.equal(
        await fs.readFile(filePath, 'utf8'),
        canonicalBefore.get(filePath),
        `rebuild must not rewrite canonical file ${path.relative(vaultRoot, filePath)}`
      );
    }
  });

  await t.test('title-only save updates projected presentation without reading Category configuration', async () => {
    const categoryBytes = await fs.readFile(categoryPath, 'utf8');
    await fs.writeFile(categoryPath, '{ invalid Category JSON', 'utf8');
    let result;
    try {
      result = await requestJson(origin, '/api/pages/page_x', {
        method: 'POST',
        body: { title: 'Page X Renamed' }
      });
    } finally {
      await fs.writeFile(categoryPath, categoryBytes, 'utf8');
    }
    assertSuccessful(result);
    assert.equal(result.body.page.title, 'Page X Renamed');

    const navigation = JSON.parse(await fs.readFile(navigationPath, 'utf8'));
    assert.deepEqual(navigation.dynamicProjection.pages.page_x, {
      id: 'page_x', title: 'Page X Renamed'
    });
    assert.deepEqual(folderByCategory(navigation, 'category_x').projectedPageIds, ['page_x']);
    assert.deepEqual(folderByCategory(navigation, 'category_y').projectedPageIds, ['page_y']);
  });

  await t.test('Category X to Y save moves persisted membership incrementally', async () => {
    const result = await requestJson(origin, '/api/pages/page_x', {
      method: 'POST',
      body: { categories: ['category_y'] }
    });
    assertSuccessful(result);
    assert.deepEqual(result.body.page.categories, ['category_y']);

    const navigation = JSON.parse(await fs.readFile(navigationPath, 'utf8'));
    assert.deepEqual(folderByCategory(navigation, 'category_x').projectedPageIds, []);
    assert.deepEqual(folderByCategory(navigation, 'category_y').projectedPageIds, ['page_x', 'page_y']);
    assert.equal(navigation.dynamicProjection.pages.page_x.title, 'Page X Renamed');
  });

  await t.test('projection publication failure rolls Page, index, and navigation back together', async () => {
    const pagePath = path.join(vaultRoot, 'pages/page_x.json');
    const before = new Map(await Promise.all([
      pagePath,
      pageIndexPath,
      navigationPath
    ].map(async (filePath) => [filePath, await fs.readFile(filePath, 'utf8')])));
    const originalWriteFile = fs.writeFile;
    let denied = false;
    fs.writeFile = async (filePath, ...args) => {
      if (!denied && path.resolve(filePath) === navigationPath) {
        denied = true;
        throw Object.assign(new Error('projection publication denied'), { code: 'EACCES' });
      }
      return originalWriteFile.call(fs, filePath, ...args);
    };
    let result;
    try {
      result = await requestJson(origin, '/api/pages/page_x', {
        method: 'POST',
        body: { categories: ['category_x'] }
      });
    } finally {
      fs.writeFile = originalWriteFile;
    }
    assert.equal(denied, true);
    assert.equal(result.response.status, 500);
    for (const [filePath, bytes] of before) {
      assert.equal(await fs.readFile(filePath, 'utf8'), bytes);
    }
  });

  await t.test('resource import leaves the navigation projection byte-identical', async () => {
    const before = await fileSnapshot(navigationPath);
    const form = new FormData();
    form.set('importTarget', 'maintenance');
    form.append('files', new Blob(['projection-neutral import'], {
      type: 'text/plain'
    }), 'projection-neutral.txt');
    const response = await fetch(`${origin}/api/pages/page_x/import`, {
      method: 'POST',
      body: form
    });
    const body = await response.json();
    assert.equal(response.status, 200, body?.error);
    const after = await fileSnapshot(navigationPath);
    assert.equal(after.bytes, before.bytes);
    assert.equal(after.mtimeNs, before.mtimeNs);
  });

  await t.test('Page create and delete materialize and remove projection state in the same response', async () => {
    const created = await requestJson(origin, '/api/pages', { method: 'POST', body: {} });
    assertSuccessful(created, 201);
    const createdPage = created.body.page;
    assert.ok(createdPage?.id);
    const navigationAfterCreate = JSON.parse(await fs.readFile(navigationPath, 'utf8'));
    assert.deepEqual(created.body.navigation, navigationAfterCreate);
    assert.deepEqual(navigationAfterCreate.dynamicProjection.pages[createdPage.id], {
      id: createdPage.id,
      title: createdPage.title
    });
    assert.equal(
      uncategoryFolder(navigationAfterCreate).projectedPageIds.includes(createdPage.id),
      true
    );

    const deleted = await requestJson(origin, `/api/pages/${createdPage.id}`, { method: 'DELETE' });
    assertSuccessful(deleted);
    assert.equal(deleted.body.deletedPageId, createdPage.id);
    const navigationAfterDelete = JSON.parse(await fs.readFile(navigationPath, 'utf8'));
    assert.deepEqual(deleted.body.navigation, navigationAfterDelete);
    assert.equal(navigationAfterDelete.dynamicProjection.pages[createdPage.id], undefined);
    assert.equal(navigationAfterDelete.items.includes(createdPage.id), false);
    assert.equal(
      navigationAfterDelete.folders.some((folder) => (
        Array.isArray(folder.projectedPageIds) && folder.projectedPageIds.includes(createdPage.id)
      )),
      false
    );
    assert.equal(
      JSON.parse(await fs.readFile(pageIndexPath, 'utf8')).pages
        .some((page) => page.id === createdPage.id),
      false
    );
    await assert.rejects(
      fs.readFile(path.join(vaultRoot, `pages/${createdPage.id}.json`)),
      (error) => error?.code === 'ENOENT'
    );
  });
});
