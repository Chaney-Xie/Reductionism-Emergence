const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('one Block accepts multiple distinct Page links and preserves every target', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-block-multi-link-'));
  const pageIds = ['page_source', 'page_alpha', 'page_beta'];
  await writeJson(path.join(vaultRoot, 'vault.json'), {
    projectId: 'project_block_multi_link', projectName: 'Block Multi Link', version: '0.2.2',
    lastOpenedPageId: 'page_source'
  });
  await writeJson(path.join(vaultRoot, 'pageIndex.json'), {
    pages: pageIds.map((id) => ({
      id,
      title: id === 'page_alpha' ? 'Alpha' : id === 'page_beta' ? 'Beta' : 'Source',
      path: `pages/${id}.json`, categories: [], categoryIds: [], descriptors: {}, descriptorIds: [],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
    }))
  });
  await writeJson(path.join(vaultRoot, 'navigation.json'), {
    version: 2, folders: [], items: pageIds, pageStates: {}
  });
  for (const pageId of pageIds) {
    await writeJson(path.join(vaultRoot, `pages/${pageId}.json`), {
      id: pageId,
      title: pageId === 'page_alpha' ? 'Alpha' : pageId === 'page_beta' ? 'Beta' : 'Source',
      categories: [], descriptors: {}, ignoredDescriptors: {}, objects: [], maintenanceResources: [],
      blocks: pageId === 'page_source' ? [{ id: 'block_source', objectId: 'object_1', links: [] }] : [],
      backlinks: [], highlightGroups: [], createdAt: '2026-01-01T00:00:00.000Z',
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

  for (const targetPageId of ['page_alpha', 'page_beta']) {
    const response = await fetch(
      `${origin}/api/pages/page_source/blocks/block_source/page-link`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetPageId, linkTypeId: 'contains' })
      }
    );
    assert.equal(response.status, 201);
  }

  const sourcePage = JSON.parse(await fs.readFile(
    path.join(vaultRoot, 'pages/page_source.json'), 'utf8'
  ));
  assert.deepEqual(sourcePage.blocks[0].links.map((link) => ({
    targetPageId: link.targetPageId,
    label: link.label
  })), [
    { targetPageId: 'page_alpha', label: 'Alpha' },
    { targetPageId: 'page_beta', label: 'Beta' }
  ]);

  const duplicate = await fetch(
    `${origin}/api/pages/page_source/blocks/block_source/page-link`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetPageId: 'page_alpha', linkTypeId: 'contains' })
    }
  );
  assert.equal(duplicate.status, 409);
});
