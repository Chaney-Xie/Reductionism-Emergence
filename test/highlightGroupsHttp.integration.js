const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test('Highlight Groups save stable IDs and Block deletion cleans membership atomically', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-highlight-groups-http-'));
  const pageId = 'page_highlight_groups';
  const pagePath = path.join(vaultRoot, 'pages/highlight-groups.json');
  await writeJson(path.join(vaultRoot, 'vault.json'), {
    projectId: 'project_highlight_groups', projectName: 'Highlight Groups', version: '0.2.2',
    lastOpenedPageId: pageId
  });
  await writeJson(path.join(vaultRoot, 'pageIndex.json'), {
    pages: [{ id: pageId, title: 'Highlight Groups', path: 'pages/highlight-groups.json' }]
  });
  await writeJson(path.join(vaultRoot, 'navigation.json'), {
    version: 2, folders: [], items: [pageId]
  });
  const blocks = [
    { id: 'block_a', objectId: 'object_1', x: 10, y: 10, width: 40, height: 30, links: [] },
    { id: 'block_b', objectId: 'object_1', x: 60, y: 10, width: 40, height: 30, links: [] }
  ];
  await writeJson(pagePath, {
    id: pageId, title: 'Highlight Groups', categories: [], descriptors: {}, ignoredDescriptors: {},
    objects: [{
      id: 'object_1', type: 'image', src: 'assets/images/A.png', displayable: true,
      x: 0, y: 0, width: 200, height: 100, naturalWidth: 200, naturalHeight: 100
    }],
    maintenanceResources: [], blocks, backlinks: [], highlightGroups: []
  });

  process.env.VIEWER_ROOT = vaultRoot;
  process.env.VIEWER_APP_ROOT = path.resolve(__dirname, '..');
  const { startServer } = require('../server/appServer');
  const server = await startServer({ host: '127.0.0.1', port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const saveGroups = await fetch(`${origin}/api/pages/${pageId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      highlightGroups: [{
        id: 'highlight_group_alpha', name: 'Alpha', blockIds: ['block_a', 'block_b'],
        info: 'Alpha info\nSecond line'
      }]
    })
  });
  assert.equal(saveGroups.status, 200);
  const groupedPage = (await saveGroups.json()).page;
  assert.deepEqual(groupedPage.highlightGroups, [{
    id: 'highlight_group_alpha', name: 'Alpha', blockIds: ['block_a', 'block_b'],
    info: 'Alpha info\nSecond line'
  }]);

  const deleteBlock = await fetch(`${origin}/api/pages/${pageId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blocks: [blocks[1]] })
  });
  assert.equal(deleteBlock.status, 200);
  const cleanedPage = (await deleteBlock.json()).page;
  assert.deepEqual(cleanedPage.highlightGroups, [{
    id: 'highlight_group_alpha', name: 'Alpha', blockIds: ['block_b'],
    info: 'Alpha info\nSecond line'
  }]);
  assert.deepEqual(JSON.parse(await fs.readFile(pagePath, 'utf8')).highlightGroups, cleanedPage.highlightGroups);

  const deleteFinalBlock = await fetch(`${origin}/api/pages/${pageId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blocks: [] })
  });
  assert.equal(deleteFinalBlock.status, 200);
  const emptyPage = (await deleteFinalBlock.json()).page;
  assert.deepEqual(emptyPage.highlightGroups, []);

  const saveEmptyGroup = await fetch(`${origin}/api/pages/${pageId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      highlightGroups: [{ id: 'highlight_group_empty', name: 'Empty', blockIds: [] }]
    })
  });
  assert.equal(saveEmptyGroup.status, 200);
  assert.deepEqual((await saveEmptyGroup.json()).page.highlightGroups, []);

  const invalid = await fetch(`${origin}/api/pages/${pageId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      highlightGroups: [
        { id: 'duplicate', name: 'One', blockIds: [] },
        { id: 'duplicate', name: 'Two', blockIds: [] }
      ]
    })
  });
  assert.equal(invalid.status, 400);
});
