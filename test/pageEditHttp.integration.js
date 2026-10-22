const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test('Page Edit persists geometry, attached Block transforms, and canonical Object order atomically', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-page-edit-http-'));
  const pageId = 'page_edit_test';
  const pagePath = path.join(vaultRoot, 'pages/page-edit.json');
  await writeJson(path.join(vaultRoot, 'vault.json'), {
    projectId: 'project_page_edit', projectName: 'Page Edit', version: '0.2.2',
    lastOpenedPageId: pageId
  });
  await writeJson(path.join(vaultRoot, 'pageIndex.json'), {
    pages: [{ id: pageId, title: 'Page Edit', path: 'pages/page-edit.json', categories: [], descriptors: [] }]
  });
  await writeJson(path.join(vaultRoot, 'navigation.json'), {
    version: 2, folders: [], items: [pageId]
  });
  await writeJson(pagePath, {
    id: pageId, title: 'Page Edit', categories: [], descriptors: {}, ignoredDescriptors: {},
    objects: [{
      id: 'object_a', type: 'image', src: 'assets/images/A.png', displayable: true,
      x: 0, y: 0, width: 200, height: 100, naturalWidth: 1000, naturalHeight: 500
    }, {
      id: 'object_b', type: 'image', src: 'assets/images/B.png', displayable: true,
      x: 50, y: 25, width: 120, height: 120, naturalWidth: 600, naturalHeight: 600
    }],
    maintenanceResources: [],
    blocks: [{
      id: 'block_a', objectId: 'object_a', x: 20, y: 10, width: 40, height: 20, links: []
    }],
    backlinks: [], highlightGroups: []
  });

  process.env.VIEWER_ROOT = vaultRoot;
  process.env.VIEWER_APP_ROOT = path.resolve(__dirname, '..');
  const { startServer } = require('../server/appServer');
  const server = await startServer({ host: '127.0.0.1', port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${origin}/api/pages/${pageId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      objects: [{ id: 'object_b', x: 300, y: 200, width: 240, height: 240 }, {
        id: 'object_a', x: 100, y: 80, width: 400, height: 200 }],
      blocks: [{
        id: 'block_a', objectId: 'object_a', x: 140, y: 100, width: 80, height: 40, links: []
      }]
    })
  });
  assert.equal(response.status, 200);
  const saved = (await response.json()).page;
  assert.deepEqual(saved.objects.map((object) => object.id), ['object_b', 'object_a']);
  assert.deepEqual(saved.objects.map(({ x, y, width, height }) => ({ x, y, width, height })), [
    { x: 300, y: 200, width: 240, height: 240 },
    { x: 100, y: 80, width: 400, height: 200 }
  ]);
  assert.equal(saved.objects[1].naturalWidth, 1000);
  assert.deepEqual(saved.blocks[0], {
    id: 'block_a', objectId: 'object_a', x: 140, y: 100, width: 80, height: 40,
    rotation: 0, info: '', links: []
  });
  assert.deepEqual(JSON.parse(await fs.readFile(pagePath, 'utf8')).objects.map((object) => object.id), [
    'object_b', 'object_a'
  ]);

  const addObject = await fetch(`${origin}/api/pages/${pageId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      allowObjectSetChanges: true,
      objects: [
        { id: 'object_b', x: 300, y: 200, width: 240, height: 240 },
        { id: 'object_a', x: 100, y: 80, width: 400, height: 200 },
        {
          id: 'object_c', type: 'image',
          location: { type: 'vault', relativePath: 'assets/images/C.png' },
          originalName: 'C.png', fileName: 'C.png', mimeType: 'image/png',
          resourceType: 'image', displayable: true, visible: true,
          x: 500, y: 300, width: 100, height: 80,
          naturalWidth: 1000, naturalHeight: 800, size: 123
        }
      ]
    })
  });
  assert.equal(addObject.status, 200);
  const addedObject = (await addObject.json()).page.objects
    .find((object) => object.id === 'object_c');
  assert.equal(addedObject.src, 'assets/images/C.png');
  assert.deepEqual(addedObject.location, {
    type: 'vault', relativePath: 'assets/images/C.png'
  });

  const beforeInvalid = await fs.readFile(pagePath, 'utf8');
  const invalid = await fetch(`${origin}/api/pages/${pageId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ objects: [{ id: 'object_a', x: 0, y: 0, width: 10, height: 10 }] })
  });
  assert.equal(invalid.status, 400);
  assert.equal(await fs.readFile(pagePath, 'utf8'), beforeInvalid);
});
