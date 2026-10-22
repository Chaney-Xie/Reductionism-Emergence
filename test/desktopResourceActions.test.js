const test = require('node:test');
const assert = require('node:assert/strict');
const { createResourceActions } = require('../desktop/resourceActions');

function quietLogger() {
  return { warn() {}, error() {} };
}

test('desktop resource actions return structured success and use validated paths only', async () => {
  const calls = [];
  const actions = createResourceActions({
    getVaultRoot: () => '/vault',
    resolveResourcePath: async (vaultRoot, relativePath) => {
      assert.equal(vaultRoot, '/vault');
      assert.equal(relativePath, 'assets/resources/example.psd');
      return { absolutePath: '/vault/assets/resources/example.psd' };
    },
    openPath: async (filePath) => { calls.push(['open', filePath]); return ''; },
    revealPath: (filePath) => calls.push(['reveal', filePath]),
    logger: quietLogger()
  });
  assert.deepEqual(await actions.openVaultResource('assets/resources/example.psd'), { ok: true });
  assert.deepEqual(await actions.revealVaultResource('assets/resources/example.psd'), { ok: true });
  assert.deepEqual(calls, [
    ['open', '/vault/assets/resources/example.psd'],
    ['reveal', '/vault/assets/resources/example.psd']
  ]);
});

test('desktop resource actions preserve validation and shell failures', async () => {
  const rejected = createResourceActions({
    getVaultRoot: () => '/vault',
    resolveResourcePath: async () => { throw new Error('Resource file not found.'); },
    openPath: async () => '',
    revealPath() {},
    logger: quietLogger()
  });
  assert.deepEqual(await rejected.openVaultResource('../secret'), {
    ok: false,
    error: 'Resource file not found.'
  });

  const noApplication = createResourceActions({
    getVaultRoot: () => '/vault',
    resolveResourcePath: async () => ({ absolutePath: '/vault/assets/resources/example.sdf' }),
    openPath: async () => 'No application is registered',
    revealPath() {},
    logger: quietLogger()
  });
  assert.deepEqual(await noApplication.openVaultResource('assets/resources/example.sdf'), {
    ok: false,
    error: 'No desktop application could open this resource.'
  });
});
