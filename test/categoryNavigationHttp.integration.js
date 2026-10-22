const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('Vault Category navigation configuration drives dynamic groups and safe definition deletion', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-category-navigation-'));
  const pages = [
    { id: 'page_both', categories: ['single', 'terminal'] },
    { id: 'page_single', categories: ['single'] },
    { id: 'page_none', categories: [] }
  ];
  await writeJson(path.join(vaultRoot, 'vault.json'), {
    projectId: 'project_category_navigation', projectName: 'Category Navigation', version: '0.2.2',
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
      ...page, title: page.id, path: `pages/${page.id}.json`, categoryIds: page.categories,
      descriptors: {}, descriptorIds: [], createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }))
  });
  await writeJson(path.join(vaultRoot, 'navigation.json'), {
    version: 2,
    folders: [
      {
        id: 'folder_uncategorised', label: 'Uncategorised', type: 'system', collapsed: true,
        source: { kind: 'missingCategories' }, children: []
      },
      {
        id: 'folder_manual', label: 'Manual', type: 'manual', collapsed: false,
        source: { kind: 'manual', pageIds: ['page_both'] }, children: []
      }
    ],
    items: ['page_single', 'page_none'], pageStates: {}
  });
  for (const page of pages) {
    await writeJson(path.join(vaultRoot, `pages/${page.id}.json`), {
      id: page.id, title: page.id, categories: page.categories, descriptors: {}, ignoredDescriptors: {},
      objects: [], maintenanceResources: [], blocks: [], backlinks: [], highlightGroups: [],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
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
  const jsonRequest = async (url, options = {}) => {
    const response = await fetch(`${origin}${url}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) }
    });
    const body = await response.json();
    assert.equal(response.ok, true, body.error);
    return body;
  };

  const enabled = await jsonRequest('/api/categories/navigation', {
    method: 'PATCH',
    body: JSON.stringify({
      enabledCategoryIds: ['terminal', 'single'],
      collapseUncategorisedPages: false,
      quantityStatistics: true
    })
  });
  assert.deepEqual(enabled.categoryConfig.navigation.enabledCategoryIds, ['single', 'terminal']);
  assert.deepEqual(enabled.navigation.folders.map((folder) => folder.id), [
    'folder_uncategorised', 'folder_category_single', 'folder_category_terminal', 'folder_manual'
  ]);
  assert.equal(enabled.navigation.folders[0].label, 'Uncategory');
  assert.equal(enabled.navigation.folders[0].collapsed, true);
  assert.equal(enabled.navigation.folders[1].collapsed, true);
  assert.equal(enabled.navigation.folders[2].collapsed, true);
  assert.equal(enabled.navigation.folders[0].excludeFromRoot, false);
  assert.equal(enabled.navigation.folders[1].excludeFromRoot, true);
  assert.deepEqual(enabled.navigation.folders.at(-1).source.pageIds, ['page_both']);

  await jsonRequest('/api/navigation/folders/folder_category_single', {
    method: 'PATCH', body: JSON.stringify({ collapsed: false })
  });
  const preserved = await jsonRequest('/api/navigation');
  assert.equal(preserved.folders.find((folder) => folder.id === 'folder_category_single').collapsed, false);

  const navigationPath = path.join(vaultRoot, 'navigation.json');
  const navigationBeforeQuantity = await fs.readFile(navigationPath, 'utf8');
  const navigationMtimeBeforeQuantity = (await fs.stat(navigationPath, { bigint: true })).mtimeNs;
  const quantityOnly = await jsonRequest('/api/categories/navigation', {
    method: 'PATCH',
    body: JSON.stringify({ quantityStatistics: false })
  });
  assert.deepEqual(quantityOnly.navigation, JSON.parse(navigationBeforeQuantity));
  assert.equal(await fs.readFile(navigationPath, 'utf8'), navigationBeforeQuantity);
  assert.equal(
    (await fs.stat(navigationPath, { bigint: true })).mtimeNs,
    navigationMtimeBeforeQuantity,
    'non-projection Category display settings do not rewrite navigation'
  );

  const singleDisabled = await jsonRequest('/api/categories/navigation', {
    method: 'PATCH',
    body: JSON.stringify({ enabledCategoryIds: ['terminal'] })
  });
  assert.equal(
    singleDisabled.navigation.folders.some((folder) => folder.id === 'folder_category_single'),
    false
  );
  const singleReenabled = await jsonRequest('/api/categories/navigation', {
    method: 'PATCH',
    body: JSON.stringify({ enabledCategoryIds: ['single', 'terminal'] })
  });
  assert.equal(
    singleReenabled.navigation.folders.find((folder) => folder.id === 'folder_category_single')
      .collapsed,
    false,
    'navigation-owned disclosure survives disable/re-enable projection updates'
  );

  const addedGroup = await jsonRequest('/api/categories/groups', {
    method: 'POST', body: '{}'
  });
  assert.match(addedGroup.group.id, /^category_group_/);
  const addedItem = await jsonRequest(`/api/categories/groups/${addedGroup.group.id}/items`, {
    method: 'POST', body: '{}'
  });
  assert.match(addedItem.item.id, /^category_/);
  assert.ok(
    addedItem.navigation.dynamicProjection.folderPresentation[`category:${addedItem.item.id}`],
    'Category creation delegates dormant stable identity to the projection owner'
  );

  const deleted = await jsonRequest('/api/categories/items/terminal', { method: 'DELETE' });
  assert.equal(deleted.categoryConfig.navigation.enabledCategoryIds.includes('terminal'), false);
  assert.equal(deleted.navigation.folders.some((folder) => folder.id === 'folder_category_terminal'), false);
  assert.deepEqual(
    deleted.navigation.folders.find((folder) => folder.id === 'folder_manual').source.pageIds,
    ['page_both']
  );
  for (const pageId of ['page_both', 'page_single', 'page_none']) {
    const page = JSON.parse(await fs.readFile(path.join(vaultRoot, `pages/${pageId}.json`), 'utf8'));
    const indexEntry = deleted.pageIndex.pages.find((entry) => entry.id === pageId);
    assert.deepEqual(page.categories, indexEntry.categoryIds);
    assert.equal(page.categories.includes('terminal'), false);
  }

  const removedGroup = await jsonRequest(`/api/categories/groups/${addedGroup.group.id}`, {
    method: 'DELETE'
  });
  assert.equal(removedGroup.categoryConfig.groups.some((group) => group.id === addedGroup.group.id), false);
  assert.equal(
    removedGroup.navigation.dynamicProjection.folderPresentation[`category:${addedItem.item.id}`],
    undefined
  );
});
