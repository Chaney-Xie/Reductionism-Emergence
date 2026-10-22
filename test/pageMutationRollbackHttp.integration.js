const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function jsonFiles(root, directory = root, result = {}) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await jsonFiles(root, filePath, result);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      result[path.relative(root, filePath)] = await fs.readFile(filePath, 'utf8');
    }
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

async function responseJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function eacces(filePath, syscall) {
  return Object.assign(new Error(`EACCES: permission denied, ${syscall} '${filePath}'`), {
    code: 'EACCES',
    errno: -13,
    path: filePath,
    syscall
  });
}

test('Page mutations roll back every JSON write when a later file returns EACCES', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-page-rollback-http-'));
  process.env.VIEWER_ROOT = vaultRoot;
  process.env.VIEWER_APP_ROOT = path.resolve(__dirname, '..');
  const { startServer } = require('../server/appServer');
  let server = await startServer({ host: '127.0.0.1', port: 0 });
  let origin = `http://127.0.0.1:${server.address().port}`;
  async function closeServer() {
    if (!server?.listening) return;
    await new Promise((resolve) => server.close(resolve));
  }
  async function restartServer() {
    await closeServer();
    server = await startServer({ host: '127.0.0.1', port: 0 });
    origin = `http://127.0.0.1:${server.address().port}`;
  }
  t.after(closeServer);
  const request = (pathname, { method = 'GET', body } = {}) => fetch(`${origin}${pathname}`, {
    method,
    ...(body === undefined ? {} : {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  });
  const pageIndexPath = path.join(vaultRoot, 'pageIndex.json');

  async function expectJsonRollback(label, deniedPath, action) {
    const before = await jsonFiles(vaultRoot);
    const originalWriteFile = fs.writeFile;
    const originalRename = fs.rename;
    let denied = false;
    fs.writeFile = async (filePath, ...args) => {
      if (!denied && path.resolve(filePath) === path.resolve(deniedPath)) {
        denied = true;
        throw eacces(deniedPath, 'write');
      }
      return originalWriteFile.call(fs, filePath, ...args);
    };
    fs.rename = async (source, destination) => {
      if (!denied && path.resolve(destination) === path.resolve(deniedPath)) {
        denied = true;
        throw eacces(deniedPath, 'rename');
      }
      return originalRename.call(fs, source, destination);
    };
    let response;
    try {
      response = await action();
    } finally {
      fs.writeFile = originalWriteFile;
      fs.rename = originalRename;
    }
    assert.equal(denied, true, `${label} must exercise the denied target`);
    assert.equal(response.status, 500, `${label} should report the denied write`);
    assert.deepEqual(await jsonFiles(vaultRoot), before, `${label} must restore every JSON file`);
  }

  async function expectImmutableTargetRollback(label, deniedPath, deniedDirectory, action) {
    const before = await jsonFiles(vaultRoot);
    const originalFileMode = (await fs.stat(deniedPath)).mode & 0o777;
    const originalDirectoryMode = (await fs.stat(deniedDirectory)).mode & 0o777;
    await fs.chmod(deniedPath, 0o444);
    await fs.chmod(deniedDirectory, 0o555);
    let response;
    try {
      response = await action();
    } finally {
      await fs.chmod(deniedDirectory, originalDirectoryMode);
      await fs.chmod(deniedPath, originalFileMode);
    }
    assert.equal(response.status, 500, `${label} should report the immutable target`);
    assert.deepEqual(await jsonFiles(vaultRoot), before, `${label} must restore every JSON file`);
  }

  await expectJsonRollback('Page create', pageIndexPath, () => request('/api/pages', {
    method: 'POST', body: {}
  }));
  assert.deepEqual(await fs.readdir(path.join(vaultRoot, 'pages')), []);

  async function createPage() {
    const response = await request('/api/pages', { method: 'POST', body: {} });
    assert.equal(response.status, 201);
    return (await responseJson(response)).page;
  }
  const source = await createPage();
  const target = await createPage();
  const sourcePath = path.join(vaultRoot, 'pages', `${source.id}.json`);
  const targetPath = path.join(vaultRoot, 'pages', `${target.id}.json`);

  await expectJsonRollback('Page rename', pageIndexPath, () => request(`/api/pages/${source.id}`, {
    method: 'POST', body: { title: 'Must Not Persist' }
  }));

  const object = {
    id: 'object_rollback_001',
    type: 'image',
    location: { type: 'vault', relativePath: 'assets/images/rollback.png' },
    originalName: 'rollback.png',
    fileName: 'rollback.png',
    mimeType: 'image/png',
    resourceType: 'png',
    displayable: true,
    visible: true,
    x: 0,
    y: 0,
    naturalWidth: 800,
    naturalHeight: 600,
    width: 640,
    height: 480,
    size: 321,
    createdAt: '2026-08-10T15:30:00.000Z'
  };
  const block = {
    id: 'block_rollback_001',
    objectId: object.id,
    x: 12,
    y: 24,
    width: 144,
    height: 96,
    rotation: 0,
    links: []
  };
  const seed = await request(`/api/pages/${source.id}`, {
    method: 'POST',
    body: { objects: [object], blocks: [block], allowObjectSetChanges: true }
  });
  assert.equal(seed.status, 200);

  await expectJsonRollback('Page body edit', pageIndexPath, () => request(`/api/pages/${source.id}`, {
    method: 'POST',
    body: {
      objects: [object],
      blocks: [{ ...block, x: 777, y: 888, width: 333, height: 222 }],
      allowObjectSetChanges: true
    }
  }));

  await expectJsonRollback('Page Category edit', pageIndexPath, () => request(`/api/pages/${source.id}`, {
    method: 'POST', body: { categories: ['level_terminal'] }
  }));

  const vocabularyResponse = await request('/api/vocabulary');
  assert.equal(vocabularyResponse.status, 200);
  const vocabulary = await responseJson(vocabularyResponse);
  vocabulary.entries.push({
    id: 'vocab_rollback_001',
    display: 'Rollback Descriptor',
    aliases: ['rollback']
  });
  const vocabularySave = await request('/api/vocabulary', { method: 'PUT', body: vocabulary });
  assert.equal(vocabularySave.status, 200);

  await expectJsonRollback('Page Descriptor edit', sourcePath, () => request(`/api/pages/${source.id}`, {
    method: 'POST',
    body: {
      descriptors: {
        class_1: [{
          entryId: 'desc_rollback_001',
          display: 'Rollback Descriptor',
          vocabularyEntryId: 'vocab_rollback_001',
          source: 'manual',
          status: 'active'
        }],
        class_2: [],
        class_3: []
      }
    }
  }));

  await expectImmutableTargetRollback(
    'Page Link creation with a non-writable parent directory',
    targetPath,
    path.dirname(targetPath),
    () => request(
      `/api/pages/${source.id}/blocks/${block.id}/page-link`,
      { method: 'POST', body: { targetPageId: target.id, linkTypeId: 'contains' } }
    )
  );

  const linkResponse = await request(`/api/pages/${source.id}/blocks/${block.id}/page-link`, {
    method: 'POST', body: { targetPageId: target.id, linkTypeId: 'contains' }
  });
  assert.equal(linkResponse.status, 201);
  const linked = await responseJson(linkResponse);

  async function backlinkProjection(label, expectedPresent) {
    const targetPage = JSON.parse(await fs.readFile(targetPath, 'utf8'));
    const pageIndex = JSON.parse(await fs.readFile(pageIndexPath, 'utf8'));
    const targetIndexEntry = pageIndex.pages.find((entry) => entry.id === target.id);
    assert.ok(targetIndexEntry, `${label} must retain the target Page index entry`);
    assert.equal(
      targetPage.updatedAt,
      targetIndexEntry.updatedAt,
      `${label} must derive the target Page index timestamp from the canonical Page`
    );
    assert.equal(
      targetPage.backlinks.some((backlink) => (
        backlink.sourcePageId === source.id && backlink.sourceLinkId === linked.link.id
      )),
      expectedPresent,
      `${label} must persist the expected target backlink state`
    );
    return { targetPage, targetIndexEntry };
  }

  const afterLinkAdd = await backlinkProjection('Page Link creation', true);
  await restartServer();
  assert.deepEqual(
    await backlinkProjection('Page Link creation after restart', true),
    afterLinkAdd,
    'a restart must preserve linked target Page/index timestamp parity'
  );

  const deleteLinkResponse = await request(
    `/api/pages/${source.id}/blocks/${block.id}/links/${linked.link.id}`,
    { method: 'DELETE' }
  );
  assert.equal(deleteLinkResponse.status, 200);
  const afterLinkDelete = await backlinkProjection('Page Link deletion', false);
  await restartServer();
  assert.deepEqual(
    await backlinkProjection('Page Link deletion after restart', false),
    afterLinkDelete,
    'a restart must preserve unlinked target Page/index timestamp parity'
  );

  const restoredLinkResponse = await request(`/api/pages/${source.id}/blocks/${block.id}/page-link`, {
    method: 'POST', body: { targetPageId: target.id, linkTypeId: 'contains' }
  });
  assert.equal(restoredLinkResponse.status, 201);

  await expectJsonRollback('Object cascade', targetPath, () => request(
    `/api/pages/${source.id}/resources/${object.id}`,
    { method: 'DELETE' }
  ));

  const deletedAssetPath = path.join(vaultRoot, 'assets/images/delete-rollback.png');
  const deletedAssetContents = Buffer.from('asset-must-survive-a-failed-page-delete');
  await fs.mkdir(path.dirname(deletedAssetPath), { recursive: true });
  await fs.writeFile(deletedAssetPath, deletedAssetContents);
  const targetObject = {
    ...object,
    id: 'object_page_delete_rollback_001',
    location: { type: 'vault', relativePath: 'assets/images/delete-rollback.png' },
    originalName: 'delete-rollback.png',
    fileName: 'delete-rollback.png',
    size: deletedAssetContents.length
  };
  const targetObjectSave = await request(`/api/pages/${target.id}`, {
    method: 'POST',
    body: { objects: [targetObject], allowObjectSetChanges: true }
  });
  assert.equal(targetObjectSave.status, 200);

  await expectJsonRollback('Page delete', pageIndexPath, () => request(
    `/api/pages/${target.id}`,
    { method: 'DELETE' }
  ));
  assert.deepEqual(await fs.readFile(deletedAssetPath), deletedAssetContents);
});
