const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test('External Links persist independently without Relations, backlinks, or Maintenance mutations', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-external-http-'));
  const pageId = 'page_external';
  const pageFile = path.join(vaultRoot, 'pages/external.json');
  await writeJson(path.join(vaultRoot, 'vault.json'), {
    projectId: 'project_external', projectName: 'External', version: '0.2.2', lastOpenedPageId: pageId
  });
  await writeJson(path.join(vaultRoot, 'pageIndex.json'), {
    pages: [{ id: pageId, title: 'External', path: 'pages/external.json', createdAt: 'now', updatedAt: 'now' }]
  });
  await writeJson(path.join(vaultRoot, 'navigation.json'), {
    version: 2, folders: [], items: [pageId], pageStates: {}
  });
  await writeJson(pageFile, {
    id: pageId, title: 'External', categories: [], descriptors: {}, ignoredDescriptors: {},
    objects: [], maintenanceResources: [{ id: 'resource_keep' }],
    blocks: [{ id: 'block_1', objectId: 'object_1', links: [] }], backlinks: [], highlightGroups: []
  });
  process.env.VIEWER_ROOT = vaultRoot;
  process.env.VIEWER_APP_ROOT = path.resolve(__dirname, '..');
  const { startServer } = require('../server/appServer');
  const server = await startServer({ host: '127.0.0.1', port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const createdResponse = await fetch(`${origin}/api/pages/${pageId}/external-links`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      displayName: 'UniProt — Hexokinase', targetKind: 'url',
      url: 'https://www.uniprot.org/', sourceBlockId: 'block_1'
    })
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.match(created.externalLink.id, /^external_/);
  assert.equal(created.page.externalLinks[0].sourceBlockId, 'block_1');
  assert.deepEqual(created.page.blocks[0].links, []);
  assert.deepEqual(created.page.backlinks, []);
  assert.equal(created.page.maintenanceResources[0].id, 'resource_keep');

  const invalid = await fetch(`${origin}/api/pages/${pageId}/external-links`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: 'Unsafe', targetKind: 'url', url: 'javascript:alert(1)' })
  });
  assert.equal(invalid.status, 400);

  const updatedResponse = await fetch(
    `${origin}/api/pages/${pageId}/external-links/${created.externalLink.id}`,
    {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Local paper', targetKind: 'file',
        fileRef: { type: 'external', externalFileId: 'external_file_paper' }
      })
    }
  );
  assert.equal(updatedResponse.status, 200);
  const updated = await updatedResponse.json();
  assert.equal(updated.externalLink.targetKind, 'file');
  assert.deepEqual(updated.externalLink.fileRef, {
    type: 'external', externalFileId: 'external_file_paper'
  });
  assert.equal(updated.externalLink.sourceBlockId, 'block_1');

  const deleted = await fetch(
    `${origin}/api/pages/${pageId}/external-links/${created.externalLink.id}`,
    { method: 'DELETE' }
  );
  assert.equal(deleted.status, 200);
  const persisted = JSON.parse(await fs.readFile(pageFile, 'utf8'));
  assert.deepEqual(persisted.externalLinks, []);
  assert.equal(persisted.maintenanceResources[0].id, 'resource_keep');
});
