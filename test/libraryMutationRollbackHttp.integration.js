const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function jsonFiles(root, directory = root, result = {}) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) await jsonFiles(root, filePath, result);
    else if (entry.isFile() && entry.name.endsWith('.json')) {
      result[path.relative(root, filePath)] = await fs.readFile(filePath, 'utf8');
    }
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

async function body(response) {
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

test('Vocabulary and Category mutations roll back all late writes on EACCES', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-library-rollback-http-'));
  process.env.VIEWER_ROOT = vaultRoot;
  process.env.VIEWER_APP_ROOT = path.resolve(__dirname, '..');
  const { startServer } = require('../server/appServer');
  const server = await startServer({ host: '127.0.0.1', port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (pathname, { method = 'GET', value } = {}) => fetch(`${origin}${pathname}`, {
    method,
    ...(value === undefined ? {} : {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value)
    })
  });

  const createdResponse = await request('/api/pages', { method: 'POST', value: {} });
  assert.equal(createdResponse.status, 201);
  const page = (await body(createdResponse)).page;
  const pagePath = path.join(vaultRoot, 'pages', `${page.id}.json`);
  const pageIndexPath = path.join(vaultRoot, 'pageIndex.json');
  const descriptorPath = path.join(vaultRoot, 'descriptors.json');

  const vocabulary = {
    version: 1,
    entries: [{
      id: 'vocab_rollback_alpha', display: 'Rollback Alpha', aliases: []
    }, {
      id: 'vocab_rollback_beta', display: 'Rollback Beta', aliases: []
    }]
  };
  const vocabularySeed = await request('/api/vocabulary', { method: 'PUT', value: vocabulary });
  assert.equal(vocabularySeed.status, 200);
  const descriptorSeed = await request(`/api/pages/${page.id}`, {
    method: 'POST',
    value: {
      categories: ['level_terminal'],
      descriptors: {
        class_1: [{
          entryId: 'desc_rollback_alpha',
          display: 'Rollback Alpha',
          vocabularyEntryId: 'vocab_rollback_alpha',
          source: 'manual',
          status: 'active'
        }, {
          entryId: 'desc_rollback_beta',
          display: 'Rollback Beta',
          vocabularyEntryId: 'vocab_rollback_beta',
          source: 'manual',
          status: 'active'
        }],
        class_2: [],
        class_3: []
      }
    }
  });
  assert.equal(descriptorSeed.status, 200);

  async function expectReadOnlyRollback(label, deniedPath, action) {
    const before = await jsonFiles(vaultRoot);
    const originalMode = (await fs.stat(deniedPath)).mode & 0o777;
    const originalRename = fs.rename;
    let deniedAtomicPublication = false;
    fs.rename = async (source, destination) => {
      if (!deniedAtomicPublication && path.resolve(destination) === path.resolve(deniedPath)) {
        deniedAtomicPublication = true;
        throw eacces(deniedPath, 'rename');
      }
      return originalRename.call(fs, source, destination);
    };
    await fs.chmod(deniedPath, 0o444);
    let response;
    try {
      response = await action();
    } finally {
      fs.rename = originalRename;
      await fs.chmod(deniedPath, originalMode);
    }
    assert.equal(response.status, 500, `${label} should report EACCES`);
    assert.deepEqual(await jsonFiles(vaultRoot), before, `${label} must restore every JSON file`);
  }

  await expectReadOnlyRollback('Vocabulary display update', descriptorPath, () => request(
    '/api/vocabulary',
    {
      method: 'PUT',
      value: {
        ...vocabulary,
        entries: vocabulary.entries.map((entry) => entry.id === 'vocab_rollback_alpha'
          ? { ...entry, display: 'Rollback Alpha Renamed' }
          : entry)
      }
    }
  ));

  await expectReadOnlyRollback('Vocabulary move', pageIndexPath, () => request(
    '/api/vocabulary/move',
    {
      method: 'POST',
      value: {
        sourceEntryId: 'vocab_rollback_alpha',
        targetEntryId: 'vocab_rollback_beta'
      }
    }
  ));

  await expectReadOnlyRollback('Vocabulary delete', pageIndexPath, () => request(
    '/api/vocabulary/vocab_rollback_alpha',
    { method: 'DELETE' }
  ));

  const beforeCategoryDelete = await jsonFiles(vaultRoot);
  const navigationPath = path.join(vaultRoot, 'navigation.json');
  const originalRename = fs.rename;
  let deniedNavigationPublication = false;
  fs.rename = async (source, destination) => {
    if (!deniedNavigationPublication && path.resolve(destination) === navigationPath) {
      deniedNavigationPublication = true;
      throw eacces(navigationPath, 'rename');
    }
    return originalRename.call(fs, source, destination);
  };
  let categoryDeleteResponse;
  try {
    categoryDeleteResponse = await request('/api/categories/items/level_terminal', {
      method: 'DELETE'
    });
  } finally {
    fs.rename = originalRename;
  }
  assert.equal(deniedNavigationPublication, true);
  assert.equal(categoryDeleteResponse.status, 500);
  assert.deepEqual(await jsonFiles(vaultRoot), beforeCategoryDelete);
  assert.deepEqual((await body(await request(`/api/pages/${page.id}`))).categories, ['level_terminal']);
  assert.equal(await fs.readFile(pagePath, 'utf8'), beforeCategoryDelete[path.relative(vaultRoot, pagePath)]);

  const unindexedPageId = 'page_unindexed_vocabulary_projection';
  const unindexedPagePath = path.join(vaultRoot, 'pages', `${unindexedPageId}.json`);
  const indexedPage = JSON.parse(await fs.readFile(pagePath, 'utf8'));
  const unindexedPage = {
    ...indexedPage,
    id: unindexedPageId,
    title: 'Unindexed Vocabulary Projection',
    categories: [],
    descriptors: {
      class_1: [{
        entryId: 'desc_rollback_alpha',
        display: 'Rollback Alpha',
        vocabularyEntryId: 'vocab_rollback_alpha',
        source: 'manual',
        status: 'active'
      }],
      class_2: [],
      class_3: []
    },
    ignoredDescriptors: {
      class_1: [{ entryId: 'desc_rollback_alpha' }],
      class_2: [],
      class_3: []
    },
    ignoredManualEntryIds: {
      class_1: ['desc_rollback_alpha'],
      class_2: [],
      class_3: []
    }
  };
  await fs.writeFile(unindexedPagePath, `${JSON.stringify(unindexedPage, null, 2)}\n`);
  assert.equal(
    JSON.parse(await fs.readFile(pageIndexPath, 'utf8')).pages
      .some((entry) => entry.id === unindexedPageId),
    false,
    'fixture must be a canonical Page absent from stale-low pageIndex'
  );

  const successfulMoveResponse = await request('/api/vocabulary/move', {
    method: 'POST',
    value: {
      sourceEntryId: 'vocab_rollback_alpha',
      targetEntryId: 'vocab_rollback_beta'
    }
  });
  assert.equal(successfulMoveResponse.status, 200);
  const successfulMove = await body(successfulMoveResponse);
  assert.equal(successfulMove.pageDescriptorRefsRemapped, 2);
  assert.ok(successfulMove.affectedPageIds.includes(unindexedPageId));
  const movedUnindexedPage = JSON.parse(await fs.readFile(unindexedPagePath, 'utf8'));
  assert.deepEqual(movedUnindexedPage.descriptors.class_1.map((ref) => ref.entryId), [
    'desc_rollback_beta'
  ]);
  assert.deepEqual(movedUnindexedPage.ignoredDescriptors.class_1.map((ref) => ref.entryId), [
    'desc_rollback_beta'
  ]);
  assert.deepEqual(movedUnindexedPage.ignoredManualEntryIds.class_1, ['desc_rollback_beta']);

  const staleLowPageIndex = JSON.parse(await fs.readFile(pageIndexPath, 'utf8'));
  staleLowPageIndex.pages = staleLowPageIndex.pages
    .filter((entry) => entry.id !== unindexedPageId);
  await fs.writeFile(pageIndexPath, `${JSON.stringify(staleLowPageIndex, null, 2)}\n`);

  const successfulDeleteResponse = await request('/api/vocabulary/vocab_rollback_beta', {
    method: 'DELETE'
  });
  assert.equal(successfulDeleteResponse.status, 200);
  const successfulDelete = await body(successfulDeleteResponse);
  assert.equal(successfulDelete.pageDescriptorRefsRemoved, 2);
  assert.ok(successfulDelete.affectedPageIds.includes(unindexedPageId));
  const deletedFromUnindexedPage = JSON.parse(await fs.readFile(unindexedPagePath, 'utf8'));
  assert.deepEqual(deletedFromUnindexedPage.descriptors.class_1, []);
  assert.deepEqual(deletedFromUnindexedPage.ignoredDescriptors.class_1, []);
  assert.deepEqual(deletedFromUnindexedPage.ignoredManualEntryIds.class_1, []);
  assert.ok(successfulDelete.metadataChangeSet.pageIndex.pages
    .some((entry) => entry.id === unindexedPageId));

  // This nominally read-only endpoint lazily recreates three support files.
  // A denial on the last read must remove the two files created earlier in
  // the request instead of leaving a half-repaired descriptor subsystem.
  const rulesPath = path.join(vaultRoot, 'descriptorSyncRules.json');
  const linkTypesPath = path.join(vaultRoot, 'linkTypes.json');
  const [savedRules, savedDescriptors] = await Promise.all([
    fs.readFile(rulesPath),
    fs.readFile(descriptorPath)
  ]);
  await Promise.all([fs.rm(rulesPath), fs.rm(descriptorPath)]);
  const linkTypesMode = (await fs.stat(linkTypesPath)).mode & 0o777;
  await fs.chmod(linkTypesPath, 0o000);
  let lazyRepairResponse;
  try {
    lazyRepairResponse = await request('/api/descriptor-sync-rules');
  } finally {
    await fs.chmod(linkTypesPath, linkTypesMode);
  }
  assert.equal(lazyRepairResponse.status, 500);
  await assert.rejects(fs.access(rulesPath), { code: 'ENOENT' });
  await assert.rejects(fs.access(descriptorPath), { code: 'ENOENT' });
  await Promise.all([
    fs.writeFile(rulesPath, savedRules),
    fs.writeFile(descriptorPath, savedDescriptors)
  ]);
});
