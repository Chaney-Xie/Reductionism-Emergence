const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function lifecycleSerializerFromSource(source) {
  const declaration = source.match(/const vaultLifecycleQueues = new Map\(\);/)?.[0];
  const implementation = source.match(
    /function serializeVaultLifecycle\(vaultId, operation\) \{[\s\S]*?\n\}/
  )?.[0];
  assert.ok(declaration);
  assert.ok(implementation);
  return Function(
    `${declaration}\n${implementation}\nreturn { serializeVaultLifecycle, vaultLifecycleQueues };`
  )();
}

function vaultOperationGateFromSource(source) {
  const runOperation = source.match(
    /function runVaultOperation\(runtime, operation\) \{[\s\S]*?\n\}/
  )?.[0];
  const quiesce = source.match(
    /async function quiesceVaultOperations\(runtime\) \{[\s\S]*?\n\}/
  )?.[0];
  assert.ok(runOperation);
  assert.ok(quiesce);
  return Function(
    `${runOperation}\n${quiesce}\nreturn { runVaultOperation, quiesceVaultOperations };`
  )();
}

function vaultOperationSettlementFromSource(source) {
  const implementation = source.match(
    /async function settleVaultRuntimeOperations\(runtimes, operation\) \{[\s\S]*?\n\}/
  )?.[0];
  assert.ok(implementation);
  return Function(
    `${implementation}\nreturn { settleVaultRuntimeOperations };`
  )();
}

test('desktop Vault runtimes own explicit server contexts from the ordinary appServer import', async () => {
  const main = await fs.readFile(path.join(ROOT, 'desktop/main.js'), 'utf8');

  assert.match(main, /const \{ createVaultServerContext \} = require\('\.\.\/server\/appServer'\)/);
  assert.doesNotMatch(main, /loadVaultServerModule|vaultServerRuntime|viewerServer/);
  assert.match(main, /createVaultServerContext\(\{[\s\S]*?vaultId: runtime\.vaultInfo\.vaultId,[\s\S]*?vaultRoot: runtime\.vaultInfo\.vaultRoot/);
  assert.match(main, /runtime\.serverContext = serverContext;[\s\S]*?serverContext\.start\(\{ port: 0, host: '127\.0\.0\.1' \}\)/);
  assert.match(main, /const closingVaultServers = new Map\(\)/);
  assert.match(main, /const vaultLifecycleOperations = new Set\(\)/);
  assert.match(main, /const vaultLifecycleQueues = new Map\(\)/);
  assert.match(main, /function runVaultOperation\(runtime, operation\)[\s\S]*?runtime\.vaultOperationsQuiescing[\s\S]*?runtime\.vaultOperations\.add\(pending\)[\s\S]*?pending\.then\(release, release\)/);
  assert.match(main, /async function quiesceVaultOperations\(runtime\)[\s\S]*?runtime\.vaultOperationsQuiescing = true;[\s\S]*?Promise\.allSettled\(\[\.\.\.runtime\.vaultOperations\]\)/);
  assert.match(main, /async function settleVaultRuntimeOperations\(runtimes, operation\)[\s\S]*?Promise\.allSettled\(runtimes\.map\(operation\)\)[\s\S]*?results\.find\(\(result\) => result\.status === 'rejected'\)[\s\S]*?throw failure\.reason/);
  assert.match(main, /function registerVaultIpcHandler\(channel, handler\)[\s\S]*?runVaultOperation\(runtime, \(\) => handler\(runtime, event, \.\.\.args\)\)/);
  assert.match(main, /function runVaultLifecycleOperation[\s\S]*?if \(quitFlushPending\)[\s\S]*?vaultLifecycleOperations\.add\(pending\)[\s\S]*?pending\.then\(release, release\)/);
  assert.match(main, /function serializeVaultLifecycle\(vaultId, operation\)[\s\S]*?vaultLifecycleQueues\.get\(vaultId\)[\s\S]*?previous\.catch\(\(\) => \{\}\)\.then\(operation\)[\s\S]*?vaultLifecycleQueues\.set\(vaultId, queued\)[\s\S]*?vaultLifecycleQueues\.delete\(vaultId\)/);
  assert.match(main, /if \(!serverContext\) \{[\s\S]*?await closingVaultServers\.get\(vaultId\)/);
  assert.match(main, /async function closeRuntimeServer\(runtime, \{ propagateError = false \} = \{\}\)[\s\S]*?runtime\.serverContext = null;[\s\S]*?closingVaultServers\.set\(vaultId, closePromise\)[\s\S]*?await closePromise/);
  assert.match(main, /closingVaultServers\.get\(vaultId\) === closePromise[\s\S]*?closingVaultServers\.delete\(vaultId\)/);
  assert.match(main, /catch \(error\) \{[\s\S]*?await closeRuntimeServer\(runtime\);[\s\S]*?throw error/);
  assert.match(main, /const opening = serializeVaultLifecycle\(vaultId, async \(\) => \{[\s\S]*?const existing = vaultRuntimes\.get\(vaultId\)[\s\S]*?closingVaultServers\.has\(vaultId\)[\s\S]*?await closingVaultServers\.get\(vaultId\)[\s\S]*?validateRegisteredVault/);
  assert.match(main, /window\.on\('closed',[\s\S]*?vaultRuntimes\.delete\(runtime\.vaultInfo\.vaultId\)[\s\S]*?closeRuntimeServer\(runtime\)/);
  assert.match(main, /window\.on\('close',[\s\S]*?runtime\.windowCloseAuthorized[\s\S]*?event\.preventDefault\(\);[\s\S]*?if \(runtime\.vaultMutationInProgress\) return;[\s\S]*?runVaultLifecycleOperation\(\(\) => serializeVaultLifecycle\([\s\S]*?flushRendererWorkspaceState\(window, \{ holdInteraction: true \}\)[\s\S]*?quiesceVaultOperations\(runtime\)[\s\S]*?runtime\.windowCloseAuthorized = true;[\s\S]*?window\.close\(\);[\s\S]*?await closeRuntimeServer\(runtime\)/);
  assert.match(main, /async function rebindRuntimeAfterRename[\s\S]*?serverAlreadyClosed = false[\s\S]*?closeRuntimeServer\(runtime, \{ propagateError: true \}\)[\s\S]*?runtime\.vaultInfo = vaultInfoFromEntry\(entry\);[\s\S]*?await startViewerServer\(runtime\)[\s\S]*?catch \(error\) \{[\s\S]*?await closeRuntimeServer\(runtime\);[\s\S]*?throw error/);
  assert.match(main, /async function reloadRuntimeAfterRename[\s\S]*?window\.loadURL\(runtime\.viewerOrigin\)[\s\S]*?focusRuntime\(runtime\)/);
  assert.match(main, /ipcMain\.handle\(IPC\.RENAME_VAULT[\s\S]*?beforeMutation: async \(\{ entry \}\) => \{[\s\S]*?flushRendererWorkspaceState\(targetRuntime\.window, \{ holdInteraction: true \}\)[\s\S]*?quiesceVaultOperations\(targetRuntime\)[\s\S]*?targetRuntimeQuiesced = true;[\s\S]*?closeRuntimeServer\(targetRuntime, \{ propagateError: true \}\)[\s\S]*?afterMutation: async \(\{ entry \}\) => \{[\s\S]*?rebindRuntimeAfterRename\(targetRuntime, entry, \{ serverAlreadyClosed: true \}\)[\s\S]*?targetRuntime\.vaultOperationsQuiescing = false;[\s\S]*?reloadRuntimeAfterRename\(targetRuntime\)/);
  assert.match(main, /ipcMain\.handle\(IPC\.RENAME_VAULT[\s\S]*?runVaultLifecycleOperation\(\(\) => serializeVaultLifecycle\(vaultId, async \(\) => \{[\s\S]*?const targetRuntime = vaultRuntimes\.get\(vaultId\)/);
  for (const channel of ['SWITCH_VAULT', 'CREATE_VAULT', 'RENAME_VAULT']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\(IPC\\.${channel}[\\s\\S]*?runVaultLifecycleOperation`));
  }
  assert.match(main, /catch \(error\) \{[\s\S]*?targetRuntime && targetRuntimeQuiesced && previousEntry[\s\S]*?rebindRuntimeAfterRename\(targetRuntime, previousEntry,[\s\S]*?serverAlreadyClosed: true/);
  assert.match(main, /app\.on\('before-quit',[\s\S]*?quitFlushPending = true;[\s\S]*?Promise\.allSettled\(\[\.\.\.vaultLifecycleOperations\]\)[\s\S]*?Promise\.allSettled\(\[\.\.\.openingVaults\.values\(\)\]\)[\s\S]*?await registryMutationQueue\.catch\(\(\) => \{\}\);[\s\S]*?settleVaultRuntimeOperations\(runtimes, async \(runtime\) => \{[\s\S]*?flushRendererWorkspaceState\(runtime\.window, \{ holdInteraction: true \}\)[\s\S]*?quiesceVaultOperations\(runtime\)[\s\S]*?settleVaultRuntimeOperations\([\s\S]*?closeRuntimeServer\(runtime\)/);
  for (const channel of [
    'GET_VAULT_INFO',
    'RESOLVE_MANAGED_RESOURCE',
    'REQUEST_DISPLAY_PROXY',
    'GET_CONTROL_SETTINGS',
    'SET_ZOOM_SENSITIVITY',
    'GET_NAVIGATION_SORT_MODE',
    'SET_NAVIGATION_SORT_MODE',
    'GET_WORKSPACE_STATE',
    'SET_WORKSPACE_STATE',
    'ADD_FILES',
    'ADD_DROPPED_FILES',
    'GET_RESOURCE_FOLDERS',
    'SELECT_DEFAULT_FOLDER',
    'ADD_READ_ONLY_FOLDER',
    'CHANGE_READ_ONLY_FOLDER',
    'REMOVE_READ_ONLY_FOLDER',
    'SET_DEFAULT_FOLDER',
    'RELINK_FOLDER',
    'OPEN_RESOURCE',
    'REVEAL_RESOURCE',
    'SELECT_EXTERNAL_LINK_FILE',
    'REGISTER_DROPPED_EXTERNAL_LINK_FILE',
    'DESCRIBE_EXTERNAL_LINK_FILE',
    'OPEN_EXTERNAL_LINK_TARGET'
  ]) {
    assert.match(main, new RegExp(`registerVaultIpcHandler\\(\\s*IPC\\.${channel}`));
  }
});

test('per-Vault lifecycle serialization orders one Vault while peer Vault work proceeds', async () => {
  const main = await fs.readFile(path.join(ROOT, 'desktop/main.js'), 'utf8');
  const { serializeVaultLifecycle, vaultLifecycleQueues } = lifecycleSerializerFromSource(main);
  const events = [];
  let releaseAlpha;
  const alphaBarrier = new Promise((resolve) => { releaseAlpha = resolve; });
  const alphaOpen = serializeVaultLifecycle('vault_alpha', async () => {
    events.push('alpha-open-start');
    await alphaBarrier;
    events.push('alpha-open-end');
  });
  const alphaRename = serializeVaultLifecycle('vault_alpha', async () => {
    events.push('alpha-rename');
  });
  const betaOpen = serializeVaultLifecycle('vault_beta', async () => {
    events.push('beta-open');
  });

  await betaOpen;
  assert.deepEqual(events, ['alpha-open-start', 'beta-open']);
  assert.equal(vaultLifecycleQueues.has('vault_alpha'), true);
  releaseAlpha();
  await Promise.all([alphaOpen, alphaRename]);
  assert.deepEqual(events, [
    'alpha-open-start',
    'beta-open',
    'alpha-open-end',
    'alpha-rename'
  ]);

  await assert.rejects(
    serializeVaultLifecycle('vault_alpha', async () => { throw new Error('expected'); }),
    /expected/
  );
  await serializeVaultLifecycle('vault_alpha', async () => { events.push('alpha-recovered'); });
  await Promise.resolve();
  assert.equal(events.at(-1), 'alpha-recovered');
  assert.equal(vaultLifecycleQueues.size, 0);
});

test('per-Vault desktop work drains before root mutation while peer work and recovery proceed', async () => {
  const main = await fs.readFile(path.join(ROOT, 'desktop/main.js'), 'utf8');
  const { runVaultOperation, quiesceVaultOperations } = vaultOperationGateFromSource(main);
  const alpha = { vaultOperations: new Set(), vaultOperationsQuiescing: false };
  const beta = { vaultOperations: new Set(), vaultOperationsQuiescing: false };
  const events = [];
  let releaseAlpha;
  const alphaBarrier = new Promise((resolve) => { releaseAlpha = resolve; });

  const alphaWork = runVaultOperation(alpha, async () => {
    events.push('alpha-start');
    await alphaBarrier;
    events.push('alpha-end');
  });
  await Promise.resolve();
  const alphaDrain = quiesceVaultOperations(alpha);
  let alphaDrained = false;
  alphaDrain.then(() => { alphaDrained = true; });

  await runVaultOperation(beta, async () => { events.push('beta'); });
  assert.deepEqual(events, ['alpha-start', 'beta']);
  assert.equal(alphaDrained, false);
  assert.equal(alpha.vaultOperationsQuiescing, true);
  await assert.rejects(
    runVaultOperation(alpha, async () => { events.push('alpha-late'); }),
    /Vault is changing/
  );

  releaseAlpha();
  await Promise.all([alphaWork, alphaDrain]);
  assert.deepEqual(events, ['alpha-start', 'beta', 'alpha-end']);
  assert.equal(alpha.vaultOperations.size, 0);
  assert.equal(beta.vaultOperations.size, 0);

  alpha.vaultOperationsQuiescing = false;
  await runVaultOperation(alpha, async () => { events.push('alpha-recovered'); });
  assert.equal(events.at(-1), 'alpha-recovered');
  assert.equal(alpha.vaultOperations.size, 0);
});

test('quit preparation reports failure only after every Vault task has settled', async () => {
  const main = await fs.readFile(path.join(ROOT, 'desktop/main.js'), 'utf8');
  const { settleVaultRuntimeOperations } = vaultOperationSettlementFromSource(main);
  const events = [];
  let releaseBeta;
  const betaBarrier = new Promise((resolve) => { releaseBeta = resolve; });
  const settling = settleVaultRuntimeOperations(['alpha', 'beta'], async (vaultId) => {
    events.push(`${vaultId}-start`);
    if (vaultId === 'alpha') throw new Error('alpha flush failed');
    await betaBarrier;
    events.push('beta-end');
  });
  let rejected = false;
  settling.catch(() => { rejected = true; });

  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events, ['alpha-start', 'beta-start']);
  assert.equal(rejected, false);

  releaseBeta();
  await assert.rejects(settling, /alpha flush failed/);
  assert.deepEqual(events, ['alpha-start', 'beta-start', 'beta-end']);
});

test('standalone startup translates its boundary inputs into one explicit context', async () => {
  const standalone = await fs.readFile(path.join(ROOT, 'server.js'), 'utf8');

  assert.match(standalone, /const \{ createVaultServerContext \} = require\('\.\/server\/appServer'\)/);
  assert.match(standalone, /createVaultServerContext\(\{[\s\S]*?appRoot: __dirname,[\s\S]*?vaultId: vault\.vaultId,[\s\S]*?vaultRoot: vault\.vaultRoot/);
  assert.match(standalone, /context\.start\(\{ port: process\.env\.PORT \|\| 3000 \}\)/);
  assert.doesNotMatch(standalone, /process\.env\.VIEWER_(?:APP_ROOT|ROOT)\s*=/);
});
