const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test('Block Edit persists nonzero rotation and canonical array order atomically', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-block-edit-http-'));
  const pageId = 'page_block_edit';
  const pagePath = path.join(vaultRoot, 'pages/block-edit.json');
  await writeJson(path.join(vaultRoot, 'vault.json'), {
    projectId: 'project_block_edit', projectName: 'Block Edit', version: '0.2.2',
    lastOpenedPageId: pageId
  });
  await writeJson(path.join(vaultRoot, 'pageIndex.json'), {
    pages: [{ id: pageId, title: 'Block Edit', path: 'pages/block-edit.json' }]
  });
  await writeJson(path.join(vaultRoot, 'navigation.json'), {
    version: 2, folders: [], items: [pageId]
  });
  await writeJson(pagePath, {
    id: pageId, title: 'Block Edit', categories: [], descriptors: {}, ignoredDescriptors: {},
    objects: [{
      id: 'object_1', type: 'image', src: 'assets/images/A.png', displayable: true,
      x: 0, y: 0, width: 300, height: 200, naturalWidth: 300, naturalHeight: 200
    }],
    maintenanceResources: [],
    blocks: [
      { id: 'block_a', objectId: 'object_1', x: 10, y: 10, width: 80, height: 40, links: [], info: 'Block note' },
      { id: 'block_b', objectId: 'object_1', x: 30, y: 20, width: 90, height: 50, rotation: 5, links: [] }
    ],
    backlinks: [], highlightGroups: []
  });

  process.env.VIEWER_ROOT = vaultRoot;
  process.env.VIEWER_APP_ROOT = path.resolve(__dirname, '..');
  const { startServer } = require('../server/appServer');
  const server = await startServer({ host: '127.0.0.1', port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const editedBlocks = [
    { id: 'block_b', objectId: 'object_1', x: 35, y: 25, width: 120, height: 60, rotation: 62.5, links: [] },
    { id: 'block_a', objectId: 'object_1', x: 10, y: 10, width: 80, height: 40, rotation: -28, links: [] }
  ];
  const response = await fetch(`${origin}/api/pages/${pageId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blocks: editedBlocks })
  });
  assert.equal(response.status, 200);
  const saved = (await response.json()).page;
  const expectedBlocks = [
    { ...editedBlocks[0], info: '' },
    { ...editedBlocks[1], info: 'Block note' }
  ];
  assert.deepEqual(saved.blocks, expectedBlocks);
  assert.deepEqual(JSON.parse(await fs.readFile(pagePath, 'utf8')).blocks, expectedBlocks);

  const beforeInvalid = await fs.readFile(pagePath, 'utf8');
  const invalid = await fetch(`${origin}/api/pages/${pageId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blocks: [{ ...editedBlocks[0], rotation: 'ninety' }] })
  });
  assert.equal(invalid.status, 400);
  assert.equal(await fs.readFile(pagePath, 'utf8'), beforeInvalid);
});
