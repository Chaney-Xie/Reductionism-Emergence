const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const navigationSort = require('../public/navigationSort');
const {
  DEFAULT_NAVIGATION_SORT_MODE,
  createDesktopSettings,
  navigationSortModeForVault,
  withNavigationSortMode
} = require('../desktop/desktopSettings');
const { loadNavigationSortModeOwner } = require('../desktop/navigationSortOwner');
const {
  migrateVaultWorkspaceStateNavigationSort,
  writeVaultWorkspaceState
} = require('../server/vaultWorkspaceState');

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function nextTurn() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function navigationSortPersistenceHarness(setNavigationSortMode) {
  const source = await fs.readFile(
    path.join(__dirname, '../public/js/navigation.js'),
    'utf8'
  );
  const start = source.indexOf('function desktopNavigationSortAvailable');
  const end = source.indexOf('\nfunction closeNavigationSortMenu', start);
  assert.notEqual(start, -1, 'navigation Sort persistence owner is present');
  assert.notEqual(end, -1, 'navigation Sort persistence owner boundary is present');
  const statusMessages = [];
  const runtime = { paneId: 'pane_sort_owner', runtimeId: 'runtime_sort_owner' };
  const context = {
    activePaneRuntime: () => runtime,
    navigationSort,
    navigationSortMode: navigationSort.DEFAULT_SORT_MODE,
    navigationSortSaveQueue: Promise.resolve(),
    renderNavigationSortMenu() {},
    renderPageList() {},
    showRuntimeStatus(ownerRuntime, message, isError) {
      assert.strictEqual(ownerRuntime, runtime);
      statusMessages.push({ isError, message });
    },
    window: {
      cneDesktop: {
        getNavigationSortMode: async () => ({ sortMode: navigationSort.DEFAULT_SORT_MODE }),
        isDesktop: true,
        setNavigationSortMode
      }
    }
  };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.navigationSortPersistenceTestApi = {
    flushNavigationSortModeSavesNow,
    persistNavigationSortMode
  };`, context);
  return { api: context.navigationSortPersistenceTestApi, context, statusMessages };
}

async function ownerFixture({ canonical, legacy, vaultId = 'vault_a' } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-navigation-sort-owner-'));
  const userDataDir = path.join(root, 'user-data');
  const vaultRoot = path.join(root, vaultId);
  const settingsStore = createDesktopSettings({ userDataDir });
  await fs.mkdir(vaultRoot, { recursive: true });
  if (canonical !== undefined) {
    await writeJson(settingsStore.settingsPath, {
      schemaVersion: 1,
      navigationSortModesByVaultId: { [vaultId]: canonical }
    });
  }
  await writeJson(path.join(vaultRoot, 'workspaceState.json'), {
    schemaVersion: 1,
    lastOpenedPageId: null,
    workspaceState: {
      searchText: 'preserved workspace',
      ...(legacy === undefined ? {} : { navigationSortMode: legacy })
    }
  });
  const mutateSettings = async (transform) => settingsStore.save(
    transform(await settingsStore.load())
  );
  return { mutateSettings, settingsStore, userDataDir, vaultId, vaultRoot };
}

async function simulateStartup(fixture) {
  const owner = await loadNavigationSortModeOwner(fixture);
  const workspaceMigration = await migrateVaultWorkspaceStateNavigationSort(
    fixture.vaultRoot
  );
  return { owner, workspaceMigration };
}

test('startup migration matrix gives a valid canonical Sort precedence and promotes legacy only once', async () => {
  const cases = [
    ['copies agree', 'modified_desc', 'modified_desc', 'modified_desc', 'global-settings', false],
    ['copies disagree', 'name_desc', 'created_asc', 'name_desc', 'global-settings', false],
    ['canonical absent', undefined, 'modified_asc', 'modified_asc', 'legacy-workspace', true],
    ['canonical invalid', 'invalid', 'created_desc', 'created_desc', 'legacy-workspace', true],
    ['both absent', undefined, undefined, DEFAULT_NAVIGATION_SORT_MODE, 'default', true],
    ['both invalid', 'invalid', 'obsolete', DEFAULT_NAVIGATION_SORT_MODE, 'default', true]
  ];

  for (const [label, canonical, legacy, expected, source, promoted] of cases) {
    const fixture = await ownerFixture({ canonical, legacy });
    const first = await simulateStartup(fixture);
    assert.equal(first.owner.sortMode, expected, label);
    assert.equal(first.owner.source, source, label);
    assert.equal(first.owner.promoted, promoted, label);
    assert.equal(
      navigationSortModeForVault(await fixture.settingsStore.load(), fixture.vaultId),
      expected,
      label
    );
    assert.equal(
      Object.hasOwn(first.workspaceMigration.state.workspaceState, 'navigationSortMode'),
      false,
      label
    );
    assert.equal(first.workspaceMigration.state.workspaceState.searchText, 'preserved workspace', label);

    const globalAfterFirst = await fs.readFile(fixture.settingsStore.settingsPath, 'utf8');
    const workspaceAfterFirst = await fs.readFile(
      path.join(fixture.vaultRoot, 'workspaceState.json'),
      'utf8'
    );
    const second = await simulateStartup(fixture);
    assert.equal(second.owner.sortMode, expected, `${label}: restart`);
    assert.equal(second.owner.source, 'global-settings', `${label}: canonical after migration`);
    assert.equal(second.owner.promoted, false, `${label}: migration is not repeated`);
    assert.equal(await fs.readFile(fixture.settingsStore.settingsPath, 'utf8'), globalAfterFirst, label);
    assert.equal(
      await fs.readFile(path.join(fixture.vaultRoot, 'workspaceState.json'), 'utf8'),
      workspaceAfterFirst,
      label
    );
  }
});

test('Sort change survives immediate workspace flush and a stale legacy snapshot without a second writer', async () => {
  const fixture = await ownerFixture({ canonical: 'name_asc' });
  await fixture.settingsStore.save(withNavigationSortMode(
    await fixture.settingsStore.load(),
    fixture.vaultId,
    'modified_desc'
  ));

  const flushed = await writeVaultWorkspaceState(fixture.vaultRoot, {
    workspaceState: {
      searchText: 'immediate flush',
      navigationSortMode: 'name_asc'
    }
  });
  assert.equal(Object.hasOwn(flushed.workspaceState, 'navigationSortMode'), false);

  await writeJson(path.join(fixture.vaultRoot, 'workspaceState.json'), {
    schemaVersion: 1,
    lastOpenedPageId: null,
    workspaceState: {
      searchText: 'stale legacy snapshot',
      navigationSortMode: 'name_asc'
    }
  });
  const restarted = await simulateStartup(fixture);
  assert.equal(restarted.owner.sortMode, 'modified_desc');
  assert.equal(restarted.owner.source, 'global-settings');
  assert.equal(restarted.workspaceMigration.state.workspaceState.searchText, 'stale legacy snapshot');
  assert.equal(
    Object.hasOwn(restarted.workspaceMigration.state.workspaceState, 'navigationSortMode'),
    false
  );
});

test('serialized renderer Sort saves drain A then B before the flush resolves', async () => {
  const gates = new Map([
    ['name_desc', deferred()],
    ['created_asc', deferred()]
  ]);
  const events = [];
  const harness = await navigationSortPersistenceHarness(async (sortMode) => {
    events.push(`start:${sortMode}`);
    await gates.get(sortMode).promise;
    events.push(`finish:${sortMode}`);
    return { ok: true, sortMode };
  });

  const saveA = harness.api.persistNavigationSortMode('name_desc');
  const saveB = harness.api.persistNavigationSortMode('created_asc');
  let flushSettled = false;
  const flush = harness.api.flushNavigationSortModeSavesNow()
    .then(() => { flushSettled = true; });

  await nextTurn();
  assert.deepEqual(events, ['start:name_desc']);
  assert.equal(flushSettled, false);

  gates.get('name_desc').resolve();
  await saveA;
  await nextTurn();
  assert.deepEqual(events, [
    'start:name_desc',
    'finish:name_desc',
    'start:created_asc'
  ]);
  assert.equal(flushSettled, false);

  gates.get('created_asc').resolve();
  assert.deepEqual(await saveB, { ok: true, sortMode: 'created_asc' });
  await flush;
  assert.deepEqual(events, [
    'start:name_desc',
    'finish:name_desc',
    'start:created_asc',
    'finish:created_asc'
  ]);
  assert.equal(flushSettled, true);
  assert.deepEqual(harness.statusMessages, []);
});

test('Reset queues the canonical default behind earlier A and B writes and wins last', async () => {
  const modes = ['modified_desc', 'created_asc', DEFAULT_NAVIGATION_SORT_MODE];
  const gates = new Map(modes.map((mode) => [mode, deferred()]));
  const events = [];
  let persistedSortMode = null;
  const harness = await navigationSortPersistenceHarness(async (sortMode) => {
    events.push(`start:${sortMode}`);
    await gates.get(sortMode).promise;
    persistedSortMode = sortMode;
    events.push(`finish:${sortMode}`);
    return { ok: true, sortMode };
  });

  const saveA = harness.api.persistNavigationSortMode('modified_desc');
  const saveB = harness.api.persistNavigationSortMode('created_asc');
  const reset = harness.api.persistNavigationSortMode(
    DEFAULT_NAVIGATION_SORT_MODE,
    { reportErrors: false }
  );
  const flush = harness.api.flushNavigationSortModeSavesNow();

  await nextTurn();
  assert.deepEqual(events, ['start:modified_desc']);
  gates.get('modified_desc').resolve();
  await saveA;
  await nextTurn();
  assert.deepEqual(events.at(-1), 'start:created_asc');
  gates.get('created_asc').resolve();
  await saveB;
  await nextTurn();
  assert.deepEqual(events.at(-1), `start:${DEFAULT_NAVIGATION_SORT_MODE}`);
  assert.equal(persistedSortMode, 'created_asc');
  gates.get(DEFAULT_NAVIGATION_SORT_MODE).resolve();
  assert.deepEqual(await reset, { ok: true, sortMode: DEFAULT_NAVIGATION_SORT_MODE });
  await flush;

  assert.equal(persistedSortMode, DEFAULT_NAVIGATION_SORT_MODE);
  assert.deepEqual(events, [
    'start:modified_desc',
    'finish:modified_desc',
    'start:created_asc',
    'finish:created_asc',
    `start:${DEFAULT_NAVIGATION_SORT_MODE}`,
    `finish:${DEFAULT_NAVIGATION_SORT_MODE}`
  ]);
});

test('an ordinary Workspace save after a Sort change cannot persist or overwrite Sort', async () => {
  const fixture = await ownerFixture({ canonical: 'name_asc' });
  await fixture.settingsStore.save(withNavigationSortMode(
    await fixture.settingsStore.load(),
    fixture.vaultId,
    'created_desc'
  ));

  const ordinarySave = await writeVaultWorkspaceState(fixture.vaultRoot, {
    lastOpenedPageId: 'page_after_sort',
    workspaceState: {
      leftSidebarOpen: false,
      navigationSortMode: 'modified_asc',
      searchText: 'ordinary workspace save'
    }
  });
  assert.equal(Object.hasOwn(ordinarySave.workspaceState, 'navigationSortMode'), false);
  assert.equal(ordinarySave.workspaceState.leftSidebarOpen, false);
  assert.equal(ordinarySave.workspaceState.searchText, 'ordinary workspace save');
  assert.equal(
    navigationSortModeForVault(await fixture.settingsStore.load(), fixture.vaultId),
    'created_desc'
  );

  const restarted = await simulateStartup(fixture);
  assert.equal(restarted.owner.sortMode, 'created_desc');
  assert.equal(restarted.owner.source, 'global-settings');
  assert.equal(Object.hasOwn(restarted.workspaceMigration.state.workspaceState, 'navigationSortMode'), false);
});

test('failed canonical promotion preserves the legacy owner for a safe retry', async () => {
  const fixture = await ownerFixture({ legacy: 'created_asc' });
  await assert.rejects(
    loadNavigationSortModeOwner({
      ...fixture,
      mutateSettings: async () => { throw new Error('simulated global write failure'); }
    }),
    /simulated global write failure/
  );
  assert.match(
    await fs.readFile(path.join(fixture.vaultRoot, 'workspaceState.json'), 'utf8'),
    /navigationSortMode/
  );

  const retried = await simulateStartup(fixture);
  assert.equal(retried.owner.sortMode, 'created_asc');
  assert.equal(retried.owner.source, 'legacy-workspace');
});

test('a transient legacy-retirement failure cannot replace a durable promoted Sort with the default', async () => {
  const fixture = await ownerFixture({ legacy: 'created_desc' });
  const workspacePath = path.join(fixture.vaultRoot, 'workspaceState.json');
  const originalRename = fs.rename;
  let blockedRetirements = 0;
  fs.rename = async (source, destination) => {
    if (path.resolve(destination) === path.resolve(workspacePath)) {
      blockedRetirements += 1;
      const error = new Error('simulated legacy retirement failure');
      error.code = 'EIO';
      throw error;
    }
    return originalRename(source, destination);
  };

  let owner;
  try {
    owner = await loadNavigationSortModeOwner(fixture);
  } finally {
    fs.rename = originalRename;
  }

  assert.equal(blockedRetirements, 1);
  assert.equal(owner.sortMode, 'created_desc');
  assert.equal(owner.source, 'legacy-workspace');
  assert.equal(owner.promoted, true);
  assert.equal(owner.legacyRetirementPending, true);
  assert.equal(
    navigationSortModeForVault(await fixture.settingsStore.load(), fixture.vaultId),
    'created_desc'
  );
  assert.match(await fs.readFile(workspacePath, 'utf8'), /navigationSortMode/);

  const retried = await migrateVaultWorkspaceStateNavigationSort(fixture.vaultRoot);
  assert.equal(retried.removedLegacyOwner, true);
  assert.equal(retried.state.workspaceState.searchText, 'preserved workspace');
  assert.equal(
    Object.hasOwn(retried.state.workspaceState, 'navigationSortMode'),
    false
  );
});

test('a newer canonical write queued during legacy inspection is never overwritten', async () => {
  const fixture = await ownerFixture({ legacy: 'created_asc' });
  const result = await loadNavigationSortModeOwner({
    ...fixture,
    mutateSettings: async (transform) => {
      const newer = withNavigationSortMode(
        await fixture.settingsStore.load(),
        fixture.vaultId,
        'modified_desc'
      );
      return fixture.settingsStore.save(transform(newer));
    }
  });
  assert.equal(result.sortMode, 'modified_desc');
  assert.equal(result.source, 'global-settings');
  assert.equal(result.promoted, false);
  assert.equal(
    navigationSortModeForVault(await fixture.settingsStore.load(), fixture.vaultId),
    'modified_desc'
  );
});

test('Reset applies the canonical default immediately without scheduling a workspace Sort save', async () => {
  const root = path.join(__dirname, '..');
  const [navigationSource, settingsSource, workspaceSource] = await Promise.all([
    fs.readFile(path.join(root, 'public/js/navigation.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/vaultSettings.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/workspaceState.js'), 'utf8')
  ]);
  const applyStart = navigationSource.indexOf('function applyNavigationSortMode');
  const applyEnd = navigationSource.indexOf('\n}\n', applyStart) + 3;
  const applySource = navigationSource.slice(applyStart, applyEnd);
  assert.match(applySource, /navigationSortMode = navigationSort\.normalizeSortMode\(value\)/);
  assert.match(applySource, /renderPageList\(\);[\s\S]*renderNavigationSortMenu\(\)/);
  assert.match(applySource, /if \(persist\) persistNavigationSortMode\(navigationSortMode\)/);
  assert.doesNotMatch(applySource, /scheduleWorkspaceStateSave/);

  const resetStart = settingsSource.indexOf('async function resetCurrentVaultSettings');
  const resetEnd = settingsSource.indexOf('\nasync function rebuildNavigationProjection', resetStart);
  const resetSource = settingsSource.slice(resetStart, resetEnd);
  assert.match(
    resetSource,
    /persistNavigationSortMode\(navigationSort\.DEFAULT_SORT_MODE, \{ reportErrors: false \}\)/
  );
  assert.match(resetSource, /applyNavigationSortMode\(sortResult\.sortMode, \{ persist: false \}\)/);
  assert.doesNotMatch(resetSource, /scheduleWorkspaceStateSave/);
  assert.doesNotMatch(workspaceSource, /navigationSortMode/);

  const fixture = await ownerFixture({ canonical: 'created_desc', legacy: 'modified_asc' });
  await fixture.settingsStore.save(withNavigationSortMode(
    await fixture.settingsStore.load(),
    fixture.vaultId,
    DEFAULT_NAVIGATION_SORT_MODE
  ));
  const restarted = await simulateStartup(fixture);
  assert.equal(restarted.owner.sortMode, DEFAULT_NAVIGATION_SORT_MODE);
  assert.equal(restarted.owner.source, 'global-settings');
});

test('Vault switch and reopen restore each Vault canonical Sort independently', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-navigation-sort-switch-'));
  const userDataDir = path.join(root, 'user-data');
  const settingsStore = createDesktopSettings({ userDataDir });
  let settings = withNavigationSortMode(null, 'vault_a', 'name_desc');
  settings = withNavigationSortMode(settings, 'vault_b', 'created_asc');
  await settingsStore.save(settings);
  const mutateSettings = async (transform) => settingsStore.save(
    transform(await settingsStore.load())
  );

  for (const [vaultId, staleLegacy, expected] of [
    ['vault_a', 'modified_desc', 'name_desc'],
    ['vault_b', 'name_asc', 'created_asc']
  ]) {
    const vaultRoot = path.join(root, vaultId);
    await writeJson(path.join(vaultRoot, 'workspaceState.json'), {
      schemaVersion: 1,
      workspaceState: { navigationSortMode: staleLegacy }
    });
    const result = await simulateStartup({ settingsStore, mutateSettings, vaultId, vaultRoot });
    assert.equal(result.owner.sortMode, expected, vaultId);
  }

  const reopened = await simulateStartup({
    settingsStore,
    mutateSettings,
    vaultId: 'vault_a',
    vaultRoot: path.join(root, 'vault_a')
  });
  assert.equal(reopened.owner.sortMode, 'name_desc');
  assert.equal(reopened.owner.promoted, false);
});

test('serialized mutations change only their addressed Vault and preserve every neighbouring owner', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-navigation-sort-isolation-'));
  const settingsStore = createDesktopSettings({ userDataDir: path.join(root, 'user-data') });
  let initial = withNavigationSortMode(null, 'vault_a', 'name_asc');
  initial = withNavigationSortMode(initial, 'vault_b', 'created_desc');
  initial = withNavigationSortMode(initial, 'vault_c', 'modified_asc');
  await settingsStore.save(initial);

  let mutationQueue = Promise.resolve();
  const mutateSettings = (transform) => {
    const operation = mutationQueue
      .catch(() => {})
      .then(async () => settingsStore.save(transform(await settingsStore.load())));
    mutationQueue = operation.catch(() => {});
    return operation;
  };
  await Promise.all([
    mutateSettings((settings) => withNavigationSortMode(settings, 'vault_a', 'name_desc')),
    mutateSettings((settings) => withNavigationSortMode(settings, 'vault_b', 'created_asc'))
  ]);

  const persisted = await settingsStore.load();
  assert.deepEqual(persisted.navigationSortModesByVaultId, {
    vault_a: 'name_desc',
    vault_b: 'created_asc',
    vault_c: 'modified_asc'
  });

  for (const [vaultId, staleLegacy, expected] of [
    ['vault_a', 'created_desc', 'name_desc'],
    ['vault_b', 'name_asc', 'created_asc'],
    ['vault_c', 'name_desc', 'modified_asc']
  ]) {
    const vaultRoot = path.join(root, vaultId);
    await writeJson(path.join(vaultRoot, 'workspaceState.json'), {
      schemaVersion: 1,
      workspaceState: {
        navigationSortMode: staleLegacy,
        searchText: vaultId
      }
    });
    const startup = await simulateStartup({ settingsStore, mutateSettings, vaultId, vaultRoot });
    assert.equal(startup.owner.sortMode, expected, vaultId);
    assert.equal(startup.owner.source, 'global-settings', vaultId);
    assert.equal(startup.workspaceMigration.state.workspaceState.searchText, vaultId);
    assert.equal(
      Object.hasOwn(startup.workspaceMigration.state.workspaceState, 'navigationSortMode'),
      false,
      vaultId
    );
  }

  assert.deepEqual((await settingsStore.load()).navigationSortModesByVaultId, {
    vault_a: 'name_desc',
    vault_b: 'created_asc',
    vault_c: 'modified_asc'
  });
});
