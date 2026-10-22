const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function fileSnapshot(filePaths) {
  return Promise.all(filePaths.map(async (filePath) => ({
    filePath,
    bytes: await fs.readFile(filePath, 'utf8'),
    mtimeNs: (await fs.stat(filePath, { bigint: true })).mtimeNs
  })));
}

async function assertSnapshotUnchanged(snapshot) {
  for (const record of snapshot) {
    assert.equal(await fs.readFile(record.filePath, 'utf8'), record.bytes, record.filePath);
    assert.equal(
      (await fs.stat(record.filePath, { bigint: true })).mtimeNs,
      record.mtimeNs,
      `${record.filePath} mtime`
    );
  }
}

test('Category item and group Rename preserve stable IDs, memberships, order, and typed ownership', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-category-rename-'));
  const pages = [
    { id: 'page_both', categories: ['single', 'terminal'] },
    { id: 'page_single', categories: ['single'] },
    { id: 'page_none', categories: [] }
  ];
  await writeJson(path.join(vaultRoot, 'vault.json'), {
    projectId: 'project_category_rename',
    projectName: 'Category Rename',
    version: '0.2.2',
    lastOpenedPageId: 'page_both'
  });
  await writeJson(path.join(vaultRoot, 'categories.json'), {
    groups: [{
      id: 'level', label: 'Level', children: [
        { type: 'item', id: 'single', label: 'SingleProcess' },
        { type: 'item', id: 'terminal', label: 'Terminal' }
      ]
    }]
  });
  await writeJson(path.join(vaultRoot, 'pageIndex.json'), {
    pages: pages.map((page) => ({
      ...page,
      title: page.id,
      path: `pages/${page.id}.json`,
      categoryIds: page.categories,
      descriptors: {},
      descriptorIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }))
  });
  await writeJson(path.join(vaultRoot, 'navigation.json'), {
    version: 3,
    folders: [{
      id: 'folder_manual',
      label: 'Manual',
      type: 'manual',
      collapsed: false,
      source: { kind: 'manual', pageIds: ['page_both'] },
      children: []
    }],
    items: ['page_single', 'page_none'],
    pageStates: {}
  });
  for (const page of pages) {
    await writeJson(path.join(vaultRoot, `pages/${page.id}.json`), {
      id: page.id,
      title: page.id,
      categories: page.categories,
      descriptors: {},
      ignoredDescriptors: {},
      objects: [],
      maintenanceResources: [],
      blocks: [],
      backlinks: [],
      highlightGroups: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });
  }
  await fs.mkdir(path.join(vaultRoot, 'assets/images'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, 'assets/resources'), { recursive: true });

  process.env.VIEWER_ROOT = vaultRoot;
  process.env.VIEWER_APP_ROOT = path.resolve(__dirname, '..');
  const { startServer } = require('../server/appServer');
  const server = await startServer({ host: '127.0.0.1', port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const requestJson = async (url, options = {}) => {
    const response = await fetch(`${origin}${url}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) }
    });
    return { response, body: await response.json() };
  };
  const okJson = async (url, options = {}) => {
    const result = await requestJson(url, options);
    assert.equal(result.response.ok, true, result.body.error);
    return result.body;
  };

  await okJson('/api/categories/navigation', {
    method: 'PATCH',
    body: JSON.stringify({ enabledCategoryIds: ['single', 'terminal'] })
  });
  await okJson('/api/navigation/folders/folder_category_terminal', {
    method: 'PATCH',
    body: JSON.stringify({ collapsed: false })
  });

  const categoriesPath = path.join(vaultRoot, 'categories.json');
  const navigationPath = path.join(vaultRoot, 'navigation.json');
  const pageIndexPath = path.join(vaultRoot, 'pageIndex.json');
  const pagePaths = pages.map((page) => path.join(vaultRoot, `pages/${page.id}.json`));
  const membershipSnapshot = await fileSnapshot([pageIndexPath, ...pagePaths]);
  const categoriesBeforeItem = JSON.parse(await fs.readFile(categoriesPath, 'utf8'));
  const navigationBeforeItem = JSON.parse(await fs.readFile(navigationPath, 'utf8'));
  const terminalFolderBefore = navigationBeforeItem.folders.find(
    (folder) => folder.source?.categoryIds?.[0] === 'terminal'
  );
  const manualFolderBefore = navigationBeforeItem.folders.find((folder) => folder.id === 'folder_manual');

  const itemRenamed = await okJson('/api/categories/items/terminal', {
    method: 'PATCH',
    body: JSON.stringify({ label: '  Terminal Runtime  ' })
  });
  assert.deepEqual(itemRenamed.item, {
    type: 'item', id: 'terminal', label: 'Terminal Runtime'
  });
  assert.deepEqual(
    itemRenamed.categoryConfig.groups[0].children.map(({ id }) => id),
    ['single', 'terminal']
  );
  assert.deepEqual(
    itemRenamed.categoryConfig.navigation,
    categoriesBeforeItem.navigation
  );
  const terminalFolderAfter = itemRenamed.navigation.folders.find(
    (folder) => folder.source?.categoryIds?.[0] === 'terminal'
  );
  assert.equal(terminalFolderAfter.label, 'Terminal Runtime');
  assert.equal(terminalFolderAfter.id, terminalFolderBefore.id);
  assert.equal(terminalFolderAfter.collapsed, terminalFolderBefore.collapsed);
  assert.deepEqual(terminalFolderAfter.source, terminalFolderBefore.source);
  assert.deepEqual(terminalFolderAfter.projectedPageIds, terminalFolderBefore.projectedPageIds);
  assert.deepEqual(
    itemRenamed.navigation.dynamicProjection.pages,
    navigationBeforeItem.dynamicProjection.pages
  );
  assert.deepEqual(
    itemRenamed.navigation.dynamicProjection.folderPresentation.uncategory,
    navigationBeforeItem.dynamicProjection.folderPresentation.uncategory
  );
  assert.deepEqual(
    itemRenamed.navigation.dynamicProjection.folderPresentation['category:single'],
    navigationBeforeItem.dynamicProjection.folderPresentation['category:single']
  );
  assert.equal(
    itemRenamed.navigation.dynamicProjection.folderPresentation['category:terminal'].id,
    navigationBeforeItem.dynamicProjection.folderPresentation['category:terminal'].id
  );
  assert.equal(
    itemRenamed.navigation.dynamicProjection.folderPresentation['category:terminal'].collapsed,
    terminalFolderBefore.collapsed
  );
  assert.deepEqual(
    itemRenamed.navigation.folders.find((folder) => folder.id === 'folder_manual'),
    manualFolderBefore
  );
  await assertSnapshotUnchanged(membershipSnapshot);

  const expectedAfterItem = structuredClone(categoriesBeforeItem);
  expectedAfterItem.groups[0].children[1].label = 'Terminal Runtime';
  assert.deepEqual(JSON.parse(await fs.readFile(categoriesPath, 'utf8')), expectedAfterItem);

  const groupChildrenBefore = structuredClone(itemRenamed.categoryConfig.groups[0].children);
  const navigationBeforeGroup = await fileSnapshot([navigationPath]);
  const groupRenamed = await okJson('/api/categories/groups/level', {
    method: 'PATCH',
    body: JSON.stringify({ label: '  Execution Level  ' })
  });
  assert.equal(groupRenamed.group.id, 'level');
  assert.equal(groupRenamed.group.label, 'Execution Level');
  assert.deepEqual(groupRenamed.group.children, groupChildrenBefore);
  assert.deepEqual(groupRenamed.navigation, JSON.parse(navigationBeforeGroup[0].bytes));
  await assertSnapshotUnchanged(navigationBeforeGroup);
  await assertSnapshotUnchanged(membershipSnapshot);

  const categoriesBeforeNoOp = await fileSnapshot([categoriesPath]);
  const noOp = await okJson('/api/categories/groups/level', {
    method: 'PATCH',
    body: JSON.stringify({ label: 'Execution Level' })
  });
  assert.equal(noOp.group.id, 'level');
  await assertSnapshotUnchanged(categoriesBeforeNoOp);

  const durableBeforeInvalid = await fileSnapshot([categoriesPath, navigationPath, pageIndexPath, ...pagePaths]);
  for (const [url, body, status] of [
    ['/api/categories/items/terminal', { label: '   ' }, 400],
    ['/api/categories/groups/level', { label: 42 }, 400],
    ['/api/categories/items/missing', { label: 'Missing' }, 404],
    ['/api/categories/groups/missing', { label: 'Missing' }, 404]
  ]) {
    const result = await requestJson(url, { method: 'PATCH', body: JSON.stringify(body) });
    assert.equal(result.response.status, status, `${url}: ${JSON.stringify(result.body)}`);
    await assertSnapshotUnchanged(durableBeforeInvalid);
  }
});
