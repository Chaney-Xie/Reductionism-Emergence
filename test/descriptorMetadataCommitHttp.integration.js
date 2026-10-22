const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function body(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => (
    error ? reject(error) : resolve()
  )));
}

test('metadata commit is revisioned, read-pure, canonical-file driven, and tombstoned', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-metadata-commit-http-'));
  let server = null;
  t.after(async () => {
    if (server?.listening) await closeServer(server);
    await fs.rm(vaultRoot, { recursive: true, force: true });
  });
  process.env.VIEWER_ROOT = vaultRoot;
  process.env.VIEWER_APP_ROOT = path.resolve(__dirname, '..');
  const { startServer } = require('../server/appServer');

  server = await startServer({ host: '127.0.0.1', port: 0 });
  let origin = `http://127.0.0.1:${server.address().port}`;
  const request = (pathname, options) => fetch(`${origin}${pathname}`, options);
  const postJson = (pathname, value) => request(pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value)
  });

  const freshSnapshotResponse = await request('/api/descriptor-metadata/snapshot');
  assert.equal(freshSnapshotResponse.status, 200);
  const freshSnapshot = await body(freshSnapshotResponse);
  assert.equal(freshSnapshot.metadataRevision, 0);
  assert.equal(freshSnapshot.pageIndex.metadataRevision, 0);
  assert.equal(freshSnapshot.descriptorRegistry.metadataRevision, 0);
  const freshSyncIndex = JSON.parse(await fs.readFile(
    path.join(vaultRoot, 'descriptorSyncIndex.json'),
    'utf8'
  ));
  assert.equal(freshSyncIndex.metadataRevision, 0);
  assert.deepEqual(freshSyncIndex.pages, {});

  const freshEvaluationResponse = await request('/api/descriptor-sync-index/evaluate');
  assert.equal(freshEvaluationResponse.status, 200);
  assert.equal((await body(freshEvaluationResponse)).metadataRevision, 0);

  const createdResponse = await postJson('/api/pages', {});
  assert.equal(createdResponse.status, 201);
  const created = await body(createdResponse);
  const pageId = created.page.id;
  assert.equal(created.metadataChangeSet.metadataRevision, 1);

  const savedResponse = await postJson(`/api/pages/${pageId}`, {
    title: 'Metadata owner',
    descriptors: {
      class_1: [{ display: 'Zulu Manual' }, { display: 'Alpha Manual' }],
      class_2: [],
      class_3: []
    },
    ignoredDescriptors: { class_1: [], class_2: [], class_3: [] },
    descriptorGroups: {
      version: 1,
      groups: {
        group_prior_revision: {
          id: 'group_prior_revision',
          name: 'Prior revision group',
          parentId: null,
          createdAt: '2026-09-14T00:00:00.000Z',
          updatedAt: '2026-09-14T00:00:00.000Z'
        }
      },
      descriptorParentByEntryId: {}
    }
  });
  assert.equal(savedResponse.status, 200);
  const saved = await body(savedResponse);
  assert.equal(saved.page.title, 'Metadata owner');
  assert.ok(saved.metadataChangeSet.metadataRevision > created.metadataChangeSet.metadataRevision);
  const savedManualOrder = saved.page.descriptors.class_1.map((ref) => ref.entryId);
  assert.deepEqual(savedManualOrder, ['desc_zulu_manual', 'desc_alpha_manual']);
  assert.deepEqual(
    saved.metadataChangeSet.pageIndex.pages
      .find((entry) => entry.id === pageId).descriptors.class_1,
    savedManualOrder,
    'no-op automatic materialization must not reorder the Page projection'
  );

  const pagePath = path.join(vaultRoot, 'pages', `${pageId}.json`);
  const pageIndexPath = path.join(vaultRoot, 'pageIndex.json');
  const registryPath = path.join(vaultRoot, 'descriptors.json');
  const syncPath = path.join(vaultRoot, 'descriptorSyncIndex.json');
  const sourceCreatedResponse = await postJson('/api/pages', {});
  assert.equal(sourceCreatedResponse.status, 201);
  const sourceCreated = await body(sourceCreatedResponse);
  const sourcePageId = sourceCreated.page.id;
  assert.equal(
    sourceCreated.metadataChangeSet.pageMetadataProjection.metadataRevision,
    sourceCreated.metadataChangeSet.metadataRevision
  );
  const priorPageInLaterRevision = sourceCreated.metadataChangeSet.pageMetadataProjection.pages
    .find((entry) => entry.id === pageId);
  assert.deepEqual(
    priorPageInLaterRevision.descriptors.class_1.map((ref) => ref.entryId),
    savedManualOrder,
    'R+2 carries Page metadata changed at R+1 even when its full Page is not in changed pages'
  );
  assert.equal(Object.hasOwn(priorPageInLaterRevision, 'blocks'), false);
  assert.ok(sourceCreated.metadataChangeSet.vocabulary.entries
    .some((entry) => entry.display === 'Zulu Manual'));
  assert.equal(
    sourceCreated.metadataChangeSet.descriptorGroups.groups.group_prior_revision.name,
    'Prior revision group',
    'R+2 carries the Descriptor group state changed with Page/vocabulary metadata at R+1'
  );
  const sourceSavedResponse = await postJson(`/api/pages/${sourcePageId}`, {
    descriptors: {
      class_1: [{ display: 'Propagation Source' }],
      class_2: [],
      class_3: []
    }
  });
  assert.equal(sourceSavedResponse.status, 200);
  const sourceSaved = await body(sourceSavedResponse);
  const sourceDescriptorId = sourceSaved.page.descriptors.class_1[0].entryId;
  const sourcePagePath = path.join(vaultRoot, 'pages', `${sourcePageId}.json`);
  const sourceWithLink = JSON.parse(await fs.readFile(sourcePagePath, 'utf8'));
  sourceWithLink.blocks = [{
    id: 'block_manual_order_regression',
    links: [{
      id: 'link_manual_order_regression',
      targetType: 'page',
      targetPageId: pageId,
      linkTypeId: 'contains',
      type: 'contains'
    }]
  }];
  await fs.writeFile(sourcePagePath, `${JSON.stringify(sourceWithLink, null, 2)}\n`);

  assert.equal((await postJson('/api/descriptor-metadata/rebuild', {})).status, 200);
  const targetWithAuto = JSON.parse(await fs.readFile(pagePath, 'utf8'));
  assert.deepEqual(
    targetWithAuto.descriptors.class_1.filter((ref) => ref.source !== 'auto')
      .map((ref) => ref.entryId),
    savedManualOrder
  );
  assert.deepEqual(
    targetWithAuto.descriptors.class_1.filter((ref) => ref.source === 'auto')
      .map((ref) => ref.entryId),
    [sourceDescriptorId]
  );
  assert.equal(
    JSON.parse(await fs.readFile(pageIndexPath, 'utf8')).pages
      .find((entry) => entry.id === pageId).updatedAt,
    targetWithAuto.updatedAt
  );
  const targetBytesWithAuto = await fs.readFile(pagePath, 'utf8');
  await closeServer(server);
  server = await startServer({ host: '127.0.0.1', port: 0 });
  origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await fs.readFile(pagePath, 'utf8'), targetBytesWithAuto);
  assert.equal(
    JSON.parse(await fs.readFile(pageIndexPath, 'utf8')).pages
      .find((entry) => entry.id === pageId).updatedAt,
    targetWithAuto.updatedAt
  );

  const sourceWithoutLink = JSON.parse(await fs.readFile(sourcePagePath, 'utf8'));
  sourceWithoutLink.blocks = [];
  await fs.writeFile(sourcePagePath, `${JSON.stringify(sourceWithoutLink, null, 2)}\n`);
  assert.equal((await postJson('/api/descriptor-metadata/rebuild', {})).status, 200);
  const targetWithoutAuto = JSON.parse(await fs.readFile(pagePath, 'utf8'));
  assert.deepEqual(
    targetWithoutAuto.descriptors.class_1.map((ref) => ref.entryId),
    savedManualOrder
  );
  assert.equal(
    JSON.parse(await fs.readFile(pageIndexPath, 'utf8')).pages
      .find((entry) => entry.id === pageId).updatedAt,
    targetWithoutAuto.updatedAt
  );
  const targetBytesWithoutAuto = await fs.readFile(pagePath, 'utf8');
  await closeServer(server);
  server = await startServer({ host: '127.0.0.1', port: 0 });
  origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await fs.readFile(pagePath, 'utf8'), targetBytesWithoutAuto);
  assert.equal(
    JSON.parse(await fs.readFile(pageIndexPath, 'utf8')).pages
      .find((entry) => entry.id === pageId).updatedAt,
    targetWithoutAuto.updatedAt
  );
  assert.equal((await request(`/api/pages/${sourcePageId}`, { method: 'DELETE' })).status, 200);

  const rawPage = JSON.parse(await fs.readFile(pagePath, 'utf8'));
  assert.deepEqual(rawPage.descriptors.class_1.map((ref) => ref.entryId), savedManualOrder);
  rawPage.ignoredManualDescriptorIds = rawPage.ignoredManualEntryIds;
  delete rawPage.ignoredManualEntryIds;
  await fs.writeFile(pagePath, `${JSON.stringify(rawPage, null, 2)}\n`);
  const pageBytesBeforeGet = await fs.readFile(pagePath, 'utf8');
  const pageIndexBytesBeforeGet = await fs.readFile(pageIndexPath, 'utf8');
  const getResponse = await request(`/api/pages/${pageId}`);
  assert.equal(getResponse.status, 200);
  const normalizedResponse = await body(getResponse);
  assert.equal(Object.hasOwn(normalizedResponse, 'ignoredManualDescriptorIds'), false);
  assert.equal(await fs.readFile(pagePath, 'utf8'), pageBytesBeforeGet);
  assert.equal(await fs.readFile(pageIndexPath, 'utf8'), pageIndexBytesBeforeGet);

  const projectionBytes = await Promise.all([
    pageIndexPath, registryPath, syncPath
  ].map((filePath) => fs.readFile(filePath, 'utf8')));
  const snapshotResponse = await request('/api/descriptor-metadata/snapshot');
  assert.equal(snapshotResponse.status, 200);
  const snapshot = await body(snapshotResponse);
  assert.equal(snapshot.pageMetadataProjection.metadataRevision, snapshot.metadataRevision);
  assert.equal(Object.hasOwn(
    snapshot.pageMetadataProjection.pages.find((entry) => entry.id === pageId),
    'blocks'
  ), false);
  assert.deepEqual(
    snapshot.pageIndex.pages.find((entry) => entry.id === pageId).descriptors.class_1,
    savedManualOrder
  );
  const evaluationResponse = await request('/api/descriptor-sync-index/evaluate');
  assert.equal(evaluationResponse.status, 200);
  assert.equal(
    (await body(evaluationResponse)).metadataRevision,
    snapshot.metadataRevision
  );
  assert.deepEqual(await Promise.all([
    pageIndexPath, registryPath, syncPath
  ].map((filePath) => fs.readFile(filePath, 'utf8'))), projectionBytes);

  await closeServer(server);
  server = await startServer({ host: '127.0.0.1', port: 0 });
  origin = `http://127.0.0.1:${server.address().port}`;
  const restartedSnapshotResponse = await request('/api/descriptor-metadata/snapshot');
  assert.equal(restartedSnapshotResponse.status, 200);
  const restartedSnapshot = await body(restartedSnapshotResponse);
  assert.equal(restartedSnapshot.metadataRevision, snapshot.metadataRevision);
  assert.deepEqual(restartedSnapshot.pageMetadataProjection, snapshot.pageMetadataProjection);

  const pageBeforeMissingDescriptor = await fs.readFile(pagePath, 'utf8');
  const pageWithMissingDescriptor = JSON.parse(pageBeforeMissingDescriptor);
  pageWithMissingDescriptor.descriptors.class_1.push({
    entryId: 'desc_missing_registry',
    source: 'manual',
    status: 'active'
  });
  await fs.writeFile(pagePath, `${JSON.stringify(pageWithMissingDescriptor, null, 2)}\n`);
  const missingDescriptorProjectionBytes = await Promise.all([
    pageIndexPath, registryPath, syncPath
  ].map((filePath) => fs.readFile(filePath, 'utf8')));
  const missingDescriptorRebuild = await postJson('/api/descriptor-metadata/rebuild', {});
  assert.equal(missingDescriptorRebuild.status, 500);
  assert.match((await body(missingDescriptorRebuild)).error, /Something went wrong/);
  assert.deepEqual(await Promise.all([
    pageIndexPath, registryPath, syncPath
  ].map((filePath) => fs.readFile(filePath, 'utf8'))), missingDescriptorProjectionBytes);
  await fs.writeFile(pagePath, pageBeforeMissingDescriptor);

  const malformedPath = path.join(vaultRoot, 'pages', 'malformed.json');
  await fs.writeFile(malformedPath, '{"title":"missing id"}\n');
  const beforeMalformedRebuild = await Promise.all([
    pageIndexPath, registryPath, syncPath
  ].map((filePath) => fs.readFile(filePath, 'utf8')));
  const malformedRebuild = await postJson('/api/descriptor-metadata/rebuild', {});
  assert.equal(malformedRebuild.status, 500);
  assert.deepEqual(await Promise.all([
    pageIndexPath, registryPath, syncPath
  ].map((filePath) => fs.readFile(filePath, 'utf8'))), beforeMalformedRebuild);
  await fs.rm(malformedPath);

  const retiredLegacy = await postJson('/api/descriptor-sync/rebuild?engine=legacy', {});
  assert.equal(retiredLegacy.status, 410);

  await closeServer(server);

  const legacyPageIndex = JSON.parse(await fs.readFile(pageIndexPath, 'utf8'));
  const legacyRegistry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
  const legacySyncIndex = JSON.parse(await fs.readFile(syncPath, 'utf8'));
  delete legacyPageIndex.metadataRevision;
  delete legacyRegistry.metadataRevision;
  delete legacySyncIndex.metadataRevision;
  await Promise.all([
    fs.writeFile(pageIndexPath, `${JSON.stringify(legacyPageIndex, null, 2)}\n`),
    fs.writeFile(registryPath, `${JSON.stringify(legacyRegistry, null, 2)}\n`),
    fs.writeFile(syncPath, `${JSON.stringify(legacySyncIndex, null, 2)}\n`)
  ]);
  server = await startServer({ host: '127.0.0.1', port: 0 });
  origin = `http://127.0.0.1:${server.address().port}`;
  const migratedResources = await Promise.all([
    pageIndexPath, registryPath, syncPath
  ].map(async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'))));
  assert.deepEqual(migratedResources.map((resource) => resource.metadataRevision), [1, 1, 1]);
  assert.deepEqual(
    JSON.parse(await fs.readFile(pagePath, 'utf8')).descriptors.class_1.map((ref) => ref.entryId),
    savedManualOrder,
    'one-time revision migration preserves durable manual ordering'
  );
  assert.equal((await body(await request('/api/descriptor-metadata/snapshot'))).metadataRevision, 1);

  await closeServer(server);
  const migratedBytes = await Promise.all([
    pageIndexPath, registryPath, syncPath
  ].map((filePath) => fs.readFile(filePath, 'utf8')));
  server = await startServer({ host: '127.0.0.1', port: 0 });
  origin = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await Promise.all([
    pageIndexPath, registryPath, syncPath
  ].map((filePath) => fs.readFile(filePath, 'utf8'))), migratedBytes);

  await closeServer(server);
  const partiallyRevisionedRegistry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
  delete partiallyRevisionedRegistry.metadataRevision;
  await fs.writeFile(registryPath, `${JSON.stringify(partiallyRevisionedRegistry, null, 2)}\n`);
  const partialBytes = await Promise.all([
    pageIndexPath, registryPath, syncPath
  ].map((filePath) => fs.readFile(filePath, 'utf8')));
  server = await startServer({ host: '127.0.0.1', port: 0 });
  origin = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await Promise.all([
    pageIndexPath, registryPath, syncPath
  ].map((filePath) => fs.readFile(filePath, 'utf8'))), partialBytes);
  assert.equal((await request('/api/descriptor-metadata/snapshot')).status, 409);
  assert.equal((await postJson('/api/descriptor-metadata/rebuild', {})).status, 200);

  await closeServer(server);
  const staleIndex = JSON.parse(await fs.readFile(pageIndexPath, 'utf8'));
  staleIndex.pages.push({
    id: 'page_stale',
    path: 'pages/missing.json',
    title: 'Stale',
    descriptors: {},
    descriptorIds: []
  });
  await fs.writeFile(pageIndexPath, `${JSON.stringify(staleIndex, null, 2)}\n`);
  const staleIndexBytes = await fs.readFile(pageIndexPath, 'utf8');
  server = await startServer({ host: '127.0.0.1', port: 0 });
  origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await fs.readFile(pageIndexPath, 'utf8'), staleIndexBytes);

  const rebuiltResponse = await postJson('/api/descriptor-metadata/rebuild', {});
  assert.equal(rebuiltResponse.status, 200);
  const rebuilt = await body(rebuiltResponse);
  assert.deepEqual(rebuilt.metadataChangeSet.deletedPageIds, ['page_stale']);
  assert.deepEqual(rebuilt.pageIndex.pages.map((entry) => entry.id), [pageId]);

  const deletedResponse = await request(`/api/pages/${pageId}`, { method: 'DELETE' });
  assert.equal(deletedResponse.status, 200);
  const deleted = await body(deletedResponse);
  assert.deepEqual(deleted.metadataChangeSet.deletedPageIds, [pageId]);
  await closeServer(server);
});
