const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createVaultServerContext } = require('../server/appServer');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function routeInventory(app) {
  const stack = app._router?.stack || app.router?.stack || [];
  return stack.filter((layer) => layer.route).map((layer) => (
    `${Object.keys(layer.route.methods).sort().join(',').toUpperCase()} ${layer.route.path}`
  ));
}

test('desktop startup owns explicit Vault contexts without cloning appServer or swapping ambient roots', () => {
  const mainSource = read('desktop/main.js');
  const compatibilityPath = path.join(ROOT, 'desktop/vaultServerRuntime.js');
  const desktopSources = [
    ['desktop/main.js', mainSource],
    ...(fs.existsSync(compatibilityPath)
      ? [['desktop/vaultServerRuntime.js', fs.readFileSync(compatibilityPath, 'utf8')]]
      : [])
  ];

  assert.match(mainSource,
    /const \{ createVaultServerContext \} = require\('\.\.\/server\/appServer'\);/);
  assert.doesNotMatch(mainSource, /loadVaultServerModule/);
  assert.match(mainSource, /runtime\.serverContext = serverContext;/);
  assert.match(mainSource, /await serverContext\.close\(\)/);

  for (const [relativePath, source] of desktopSources) {
    assert.doesNotMatch(source, /\bnew\s+Module\s*\(/,
      `${relativePath} must not create cloned CommonJS module instances`);
    assert.doesNotMatch(source, /\._compile\s*\(/,
      `${relativePath} must not compile appServer source dynamically`);
    assert.doesNotMatch(source, /Module\._nodeModulePaths/,
      `${relativePath} must not reconstruct a private module loader`);
    assert.doesNotMatch(source, /readFileSync\s*\(/,
      `${relativePath} must not reread production source for runtime isolation`);
    assert.doesNotMatch(source, /process\.env\.(?:VIEWER_APP_ROOT|VIEWER_ROOT)\s*=/,
      `${relativePath} must not swap process-global Vault roots`);
  }
});

test('the context factory owns request-time state while the standalone entry is only an explicit boundary', () => {
  const appServerSource = read('server/appServer.js');
  const standaloneSource = read('server.js');
  const factoryStart = appServerSource.indexOf('function createVaultServerContext(');
  const compatibilityStart = appServerSource.indexOf('async function compatibilityVaultId(');

  assert.ok(factoryStart >= 0, 'appServer exports an explicit context factory');
  assert.ok(compatibilityStart > factoryStart, 'the compatibility boundary follows the context owner');
  const factorySource = appServerSource.slice(factoryStart, compatibilityStart);
  assert.match(factorySource, /const app = express\(\);/);
  assert.match(factorySource, /let pageMutationQueue = Promise\.resolve\(\);/);
  assert.match(factorySource, /let vaultPreferenceMutationQueue = Promise\.resolve\(\);/);
  assert.doesNotMatch(factorySource, /process\.env/,
    'request-time context construction is independent of ambient process state');
  assert.match(appServerSource, /module\.exports = \{\s*createVaultServerContext,\s*startServer\s*\};/s);

  assert.match(standaloneSource, /createVaultServerContext/);
  assert.doesNotMatch(standaloneSource, /process\.env\.(?:VIEWER_APP_ROOT|VIEWER_ROOT)\s*=/,
    'the standalone adapter may read boundary options but must not mutate global roots');
  assert.doesNotMatch(standaloneSource, /loadVaultServerModule|\._compile\s*\(|\bnew\s+Module\s*\(/);
});

test('every context installs the frozen HTTP route contract independently', () => {
  const first = createVaultServerContext({
    appRoot: ROOT,
    vaultId: 'vault_route_alpha',
    vaultRoot: path.join('/tmp', 'vault_route_alpha')
  });
  const second = createVaultServerContext({
    appRoot: ROOT,
    vaultId: 'vault_route_beta',
    vaultRoot: path.join('/tmp', 'vault_route_beta')
  });
  const firstRoutes = routeInventory(first.app);
  const secondRoutes = routeInventory(second.app);

  assert.notStrictEqual(first.app, second.app);
  assert.deepEqual(secondRoutes, firstRoutes);
  assert.equal(firstRoutes.length, 70);
  assert.equal(
    crypto.createHash('sha256').update(JSON.stringify(firstRoutes)).digest('hex'),
    '36d88585a63c650f2d519f5e80154da0a418e4a3cb9fdd5ff4c3d580ef140e06'
  );
});
