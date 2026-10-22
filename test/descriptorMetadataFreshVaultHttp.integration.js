const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createEmptyVault,
  validateVault,
  vaultMetadata
} = require('../server/vaultContext');

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => (
    error ? reject(error) : resolve()
  )));
}

async function fileBytes(root, names) {
  return Promise.all(names.map((name) => fs.readFile(path.join(root, name), 'utf8')));
}

test('a created Vault starts with one coherent revision-zero cohort and startup stays passive', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-fresh-metadata-vault-'));
  let server = null;
  t.after(async () => {
    if (server?.listening) await closeServer(server);
    await fs.rm(vaultRoot, { recursive: true, force: true });
  });

  await createEmptyVault(vaultRoot, vaultMetadata({
    vaultId: 'vault_fresh_metadata',
    displayName: 'Fresh Metadata',
    now: '2026-09-14T00:00:00.000Z'
  }), {});
  const cohortNames = [
    'pageIndex.json',
    'descriptors.json',
    'descriptorSyncIndex.json',
    'descriptorGroups.json',
    'descriptorSyncRules.json'
  ];
  const beforeStart = await fileBytes(vaultRoot, cohortNames);

  process.env.VIEWER_ROOT = vaultRoot;
  process.env.VIEWER_APP_ROOT = path.resolve(__dirname, '..');
  const { startServer } = require('../server/appServer');
  server = await startServer({ host: '127.0.0.1', port: 0 });
  let origin = `http://127.0.0.1:${server.address().port}`;
  const freshResponse = await fetch(`${origin}/api/descriptor-metadata/snapshot`);
  assert.equal(freshResponse.status, 200);
  const fresh = await freshResponse.json();
  assert.equal(fresh.metadataRevision, 0);
  assert.equal(fresh.pageIndex.metadataRevision, 0);
  assert.equal(fresh.descriptorRegistry.metadataRevision, 0);
  assert.equal(fresh.pageMetadataProjection.metadataRevision, 0);
  assert.deepEqual(fresh.pageMetadataProjection.pages, []);
  assert.deepEqual(await fileBytes(vaultRoot, cohortNames), beforeStart);

  await closeServer(server);
  server = null;
  for (const name of [
    'descriptorSyncIndex.json',
    'descriptorGroups.json',
    'descriptorSyncRules.json'
  ]) {
    await fs.rm(path.join(vaultRoot, name));
  }
  assert.equal((await validateVault(vaultRoot)).valid, true);
  const stableOwnerNames = ['pageIndex.json', 'descriptors.json', 'vocabulary.json'];
  const beforeLegacyStart = await fileBytes(vaultRoot, stableOwnerNames);

  server = await startServer({ host: '127.0.0.1', port: 0 });
  origin = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await fileBytes(vaultRoot, stableOwnerNames), beforeLegacyStart);
  for (const name of [
    'descriptorSyncIndex.json',
    'descriptorGroups.json',
    'descriptorSyncRules.json'
  ]) {
    await assert.rejects(fs.access(path.join(vaultRoot, name)), { code: 'ENOENT' });
  }
  assert.equal((await fetch(`${origin}/api/descriptor-metadata/snapshot`)).status, 409);

  const rebuildResponse = await fetch(`${origin}/api/descriptor-metadata/rebuild`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  });
  assert.equal(rebuildResponse.status, 200);
  const rebuilt = await rebuildResponse.json();
  assert.deepEqual(rebuilt.metadataChangeSet.descriptorGroups, {
    version: 1,
    groups: {},
    descriptorParentByEntryId: {}
  });
  await assert.rejects(
    fs.access(path.join(vaultRoot, 'descriptorGroups.json')),
    { code: 'ENOENT' }
  );
  await assert.rejects(
    fs.access(path.join(vaultRoot, 'descriptorSyncRules.json')),
    { code: 'ENOENT' }
  );
  const rebuiltSnapshotResponse = await fetch(`${origin}/api/descriptor-metadata/snapshot`);
  assert.equal(rebuiltSnapshotResponse.status, 200);
  assert.deepEqual(
    (await rebuiltSnapshotResponse.json()).descriptorGroups,
    rebuilt.metadataChangeSet.descriptorGroups
  );
});
