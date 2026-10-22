const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createEmptyVault, validateVault, vaultMetadata } = require('../server/vaultContext');
const {
  createRegisteredVault,
  listRegisteredVaults,
  normalizeVaultName,
  renameRegisteredVault,
  selectRegisteredVault
} = require('../server/vaultRegistry');

async function makeRegistry() {
  const appDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-vault-registry-'));
  const vaultRoot = path.join(appDataRoot, 'vaults', 'Alpha');
  const now = '2026-08-01T00:00:00.000Z';
  await createEmptyVault(vaultRoot, vaultMetadata({
    vaultId: 'vault_alpha', displayName: 'Alpha', now
  }), { fsImpl: fs });
  await fs.writeFile(path.join(appDataRoot, 'vault-registry.json'), `${JSON.stringify({
    schemaVersion: 1,
    currentVaultId: 'vault_alpha',
    vaults: [{
      vaultId: 'vault_alpha', displayName: 'Alpha', vaultRoot,
      folderName: 'Alpha', createdAt: now, lastOpenedAt: now
    }]
  }, null, 2)}\n`);
  return { appDataRoot, vaultRoot };
}

test('Vault names are trimmed and reject unsafe or ambiguous folder names', () => {
  assert.equal(normalizeVaultName('  Protein Atlas  '), 'Protein Atlas');
  for (const value of ['', ' ', '.', '..', 'A/B', 'A:B', 'A\u0000B']) {
    assert.throws(() => normalizeVaultName(value), { code: 'INVALID_NAME' });
  }
});

test('Add New Vault creates one isolated complete named Vault without switching prematurely', async () => {
  const { appDataRoot } = await makeRegistry();
  const created = await createRegisteredVault(appDataRoot, 'Protein Atlas', {
    idFactory: () => 'stable-id',
    now: '2026-08-02T00:00:00.000Z'
  });
  assert.equal(created.entry.vaultId, 'vault_stableid');
  assert.equal(created.entry.vaultRoot, path.join(appDataRoot, 'vaults', 'Protein Atlas'));
  assert.equal((await validateVault(created.entry.vaultRoot)).valid, true);
  assert.deepEqual(JSON.parse(await fs.readFile(
    path.join(created.entry.vaultRoot, 'pageIndex.json'), 'utf8'
  )), { metadataRevision: 0, pages: [] });
  const metadata = JSON.parse(await fs.readFile(
    path.join(created.entry.vaultRoot, 'vault.json'), 'utf8'
  ));
  assert.deepEqual(metadata.defaultManagedResourceLocation, {
    type: 'vault',
    imageRoot: 'assets/images',
    resourceRoot: 'assets/resources'
  });
  assert.equal((await fs.stat(path.join(created.entry.vaultRoot, 'assets/images'))).isDirectory(), true);
  assert.equal((await fs.stat(path.join(created.entry.vaultRoot, 'assets/resources'))).isDirectory(), true);
  const listed = await listRegisteredVaults(appDataRoot);
  assert.equal(listed.currentVaultId, 'vault_alpha');
  assert.deepEqual(listed.vaults.map((vault) => vault.displayName), ['Alpha', 'Protein Atlas']);
  await assert.rejects(
    createRegisteredVault(appDataRoot, 'protein atlas'),
    { code: 'DUPLICATE_NAME' }
  );
});

test('switch validates by stable ID before atomically updating the current registry entry', async () => {
  const { appDataRoot } = await makeRegistry();
  await createRegisteredVault(appDataRoot, 'Beta', { idFactory: () => 'beta' });
  const selected = await selectRegisteredVault(appDataRoot, 'vault_beta', {
    now: '2026-08-03T00:00:00.000Z'
  });
  assert.equal(selected.registry.currentVaultId, 'vault_beta');
  await assert.rejects(selectRegisteredVault(appDataRoot, 'missing'), { code: 'VAULT_NOT_FOUND' });
  assert.equal((await listRegisteredVaults(appDataRoot)).currentVaultId, 'vault_beta');
});

test('rename changes the managed folder and display name while preserving the stable Vault ID', async () => {
  const { appDataRoot, vaultRoot } = await makeRegistry();
  await fs.writeFile(path.join(vaultRoot, 'assets', 'resources', 'keep.psd'), 'resource');
  const renamed = await renameRegisteredVault(appDataRoot, 'vault_alpha', 'Protein Structures', {
    now: '2026-08-04T00:00:00.000Z'
  });
  const renamedRoot = path.join(appDataRoot, 'vaults', 'Protein Structures');
  assert.equal(renamed.entry.vaultId, 'vault_alpha');
  assert.equal(renamed.entry.vaultRoot, renamedRoot);
  assert.equal(await fs.readFile(path.join(renamedRoot, 'assets/resources/keep.psd'), 'utf8'), 'resource');
  const metadata = JSON.parse(await fs.readFile(path.join(renamedRoot, 'vault.json'), 'utf8'));
  assert.equal(metadata.vaultId, 'vault_alpha');
  assert.equal(metadata.displayName, 'Protein Structures');
  await assert.rejects(fs.access(vaultRoot), { code: 'ENOENT' });

  const caseOnly = await renameRegisteredVault(appDataRoot, 'vault_alpha', 'PROTEIN STRUCTURES', {
    idFactory: () => 'case-only'
  });
  assert.equal(caseOnly.entry.vaultId, 'vault_alpha');
  assert.equal(path.basename(caseOnly.entry.vaultRoot), 'PROTEIN STRUCTURES');
  assert.equal((await validateVault(caseOnly.entry.vaultRoot)).valid, true);
});

test('renaming an inactive Vault leaves the active Vault identity unchanged', async () => {
  const { appDataRoot } = await makeRegistry();
  await createRegisteredVault(appDataRoot, 'Beta', { idFactory: () => 'beta' });
  const renamed = await renameRegisteredVault(appDataRoot, 'vault_beta', 'Gamma');
  assert.equal(renamed.registry.currentVaultId, 'vault_alpha');
  assert.equal((await listRegisteredVaults(appDataRoot)).currentVaultId, 'vault_alpha');
  assert.equal(path.basename(renamed.entry.vaultRoot), 'Gamma');
});

test('rename rolls the directory, metadata, and registry back when publication fails', async () => {
  const { appDataRoot, vaultRoot } = await makeRegistry();
  const registryPath = path.join(appDataRoot, 'vault-registry.json');
  let failRegistryPublish = true;
  const failingFs = new Proxy(fs, {
    get(target, property) {
      if (property !== 'rename') return target[property];
      return async (source, destination) => {
        if (failRegistryPublish && destination === registryPath) {
          failRegistryPublish = false;
          const error = new Error('injected registry publication failure');
          error.code = 'EIO';
          throw error;
        }
        return target.rename(source, destination);
      };
    }
  });

  await assert.rejects(
    renameRegisteredVault(appDataRoot, 'vault_alpha', 'Beta', { fsImpl: failingFs }),
    /injected registry publication failure/
  );
  const metadata = JSON.parse(await fs.readFile(path.join(vaultRoot, 'vault.json'), 'utf8'));
  const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
  assert.equal(metadata.displayName, 'Alpha');
  assert.equal(registry.vaults[0].displayName, 'Alpha');
  assert.equal(registry.vaults[0].vaultRoot, vaultRoot);
  assert.equal(await fs.stat(vaultRoot).then((entry) => entry.isDirectory()), true);
  await assert.rejects(fs.access(path.join(appDataRoot, 'vaults', 'Beta')), { code: 'ENOENT' });
});

test('rename lifecycle hooks bracket publication and post-publication failure rolls back', async () => {
  const { appDataRoot, vaultRoot } = await makeRegistry();
  const targetRoot = path.join(appDataRoot, 'vaults', 'Beta');
  const registryPath = path.join(appDataRoot, 'vault-registry.json');
  const events = [];

  await assert.rejects(
    renameRegisteredVault(appDataRoot, 'vault_alpha', 'Beta', {
      beforeMutation: async ({ entry, displayName, oldRoot, targetRoot: plannedRoot }) => {
        events.push('before');
        assert.equal(entry.vaultId, 'vault_alpha');
        assert.equal(displayName, 'Beta');
        assert.equal(oldRoot, vaultRoot);
        assert.equal(plannedRoot, targetRoot);
        assert.equal((await fs.stat(vaultRoot)).isDirectory(), true);
        await assert.rejects(fs.access(targetRoot), { code: 'ENOENT' });
        const flushedMetadata = JSON.parse(await fs.readFile(path.join(vaultRoot, 'vault.json'), 'utf8'));
        flushedMetadata.preferences = { theme: 'flushed-before-rename' };
        await fs.writeFile(
          path.join(vaultRoot, 'vault.json'),
          `${JSON.stringify(flushedMetadata, null, 2)}\n`,
          'utf8'
        );
      },
      afterMutation: async ({ entry, changed }) => {
        events.push('after');
        assert.equal(changed, true);
        assert.equal(entry.vaultRoot, targetRoot);
        assert.equal((await fs.stat(targetRoot)).isDirectory(), true);
        await assert.rejects(fs.access(vaultRoot), { code: 'ENOENT' });
        const published = JSON.parse(await fs.readFile(registryPath, 'utf8'));
        assert.equal(published.vaults[0].vaultRoot, targetRoot);
        throw new Error('injected runtime rebind failure');
      }
    }),
    /injected runtime rebind failure/
  );

  assert.deepEqual(events, ['before', 'after']);
  assert.equal((await fs.stat(vaultRoot)).isDirectory(), true);
  await assert.rejects(fs.access(targetRoot), { code: 'ENOENT' });
  const metadata = JSON.parse(await fs.readFile(path.join(vaultRoot, 'vault.json'), 'utf8'));
  const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
  assert.equal(metadata.displayName, 'Alpha');
  assert.deepEqual(metadata.preferences, { theme: 'flushed-before-rename' });
  assert.equal(registry.vaults[0].displayName, 'Alpha');
  assert.equal(registry.vaults[0].vaultRoot, vaultRoot);

  let noChangeHookCalled = false;
  const unchanged = await renameRegisteredVault(appDataRoot, 'vault_alpha', 'Alpha', {
    beforeMutation: async () => { noChangeHookCalled = true; },
    afterMutation: async () => { noChangeHookCalled = true; }
  });
  assert.equal(unchanged.changed, false);
  assert.equal(noChangeHookCalled, false);
});
