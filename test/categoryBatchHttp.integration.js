const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('batch Category save updates Page JSON and pageIndex together while skipping stale IDs', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-category-batch-'));
  const pageDefinitions = [
    ['page_a', ['tool', 'neutral']],
    ['page_b', ['foundation', 'tool']],
    ['page_c', ['neutral']]
  ];
  await writeJson(path.join(vaultRoot, 'vault.json'), {
    projectId: 'project_category_batch', projectName: 'Category Batch', version: '0.2.2',
    lastOpenedPageId: 'page_a'
  });
  await writeJson(path.join(vaultRoot, 'categories.json'), {
    navigation: {
      enabledCategoryIds: ['foundation', 'tool', 'neutral'],
      collapseUncategorisedPages: true,
      quantityStatistics: false
    },
    groups: [{
      id: 'content', label: 'Content', children: [
        { type: 'item', id: 'foundation', label: 'Foundation' },
        { type: 'item', id: 'tool', label: 'Tool' },
        { type: 'item', id: 'neutral', label: 'Neutral' }
      ]
    }]
  });
  await writeJson(path.join(vaultRoot, 'pageIndex.json'), {
    pages: pageDefinitions.map(([id, categories]) => ({
      id, title: id, path: `pages/${id}.json`, categories, categoryIds: categories,
      descriptors: {}, descriptorIds: [], createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }))
  });
  await writeJson(path.join(vaultRoot, 'navigation.json'), {
    version: 2, folders: [], items: pageDefinitions.map(([id]) => id), pageStates: {}
  });
  for (const [id, categories] of pageDefinitions) {
    await writeJson(path.join(vaultRoot, `pages/${id}.json`), {
      id, title: id, categories, descriptors: {}, objects: [], maintenanceResources: [],
      blocks: [{ id: `block_${id}`, x: 1, y: 2, width: 3, height: 4, links: [] }],
      backlinks: [], createdAt: '2026-01-01T00:00:00.000Z',
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
  const navigationBefore = await fs.readFile(path.join(vaultRoot, 'navigation.json'), 'utf8');

  const response = await fetch(`${origin}/api/pages/categories/batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pageIds: ['page_a', 'page_b', 'page_c', 'page_stale'],
      addCategoryIds: ['foundation'],
      removeCategoryIds: ['tool']
    })
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.changedPageIds, ['page_a', 'page_b', 'page_c']);
  assert.deepEqual(result.stalePageIds, ['page_stale']);

  const expected = new Map([
    ['page_a', ['neutral', 'foundation']],
    ['page_b', ['foundation']],
    ['page_c', ['neutral', 'foundation']]
  ]);
  const savedIndex = JSON.parse(await fs.readFile(path.join(vaultRoot, 'pageIndex.json'), 'utf8'));
  for (const [pageId, categories] of expected) {
    const page = JSON.parse(await fs.readFile(path.join(vaultRoot, `pages/${pageId}.json`), 'utf8'));
    const indexEntry = savedIndex.pages.find((entry) => entry.id === pageId);
    assert.deepEqual(page.categories, categories);
    assert.deepEqual(indexEntry.categories, categories);
    assert.deepEqual(indexEntry.categoryIds, categories);
    assert.equal(page.updatedAt, indexEntry.updatedAt);
    assert.deepEqual(page.blocks, [{
      id: `block_${pageId}`, x: 1, y: 2, width: 3, height: 4, links: [], info: ''
    }]);
  }
  const navigationAfter = await fs.readFile(path.join(vaultRoot, 'navigation.json'), 'utf8');
  assert.notEqual(navigationAfter, navigationBefore);
  const savedNavigation = JSON.parse(navigationAfter);
  assert.deepEqual(result.navigation, savedNavigation);
  const projectedIds = (categoryId) => savedNavigation.folders.find((folder) => (
    folder.source?.kind === 'categoryAny'
    && folder.source?.categoryIds?.[0] === categoryId
  ))?.projectedPageIds;
  assert.deepEqual(projectedIds('foundation'), ['page_a', 'page_b', 'page_c']);
  assert.deepEqual(projectedIds('tool'), []);
  assert.deepEqual(projectedIds('neutral'), ['page_a', 'page_c']);

  const invalidResponse = await fetch(`${origin}/api/pages/categories/batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pageIds: ['page_a', 'page_b'],
      addCategoryIds: ['foundation'],
      removeCategoryIds: ['foundation']
    })
  });
  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(vaultRoot, 'pages/page_a.json'), 'utf8')).categories,
    expected.get('page_a')
  );
});
