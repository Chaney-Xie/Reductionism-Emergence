const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createEmptyVault, vaultMetadata } = require('../server/vaultContext');
const { updateVaultWorkspaceState } = require('../server/vaultWorkspaceState');
const { createVaultServerContext } = require('../server/appServer');

const APP_ROOT = path.join(__dirname, '..');

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function seedVault({ topLevel, nested } = {}) {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-last-opened-owner-'));
  await createEmptyVault(vaultRoot, vaultMetadata({
    vaultId: `vault_${path.basename(vaultRoot)}`,
    displayName: 'Last Opened Owner',
    now: '2026-08-30T00:00:00.000Z'
  }), {});
  const pageIds = ['page_a', 'page_b', 'page_c'];
  await writeJson(path.join(vaultRoot, 'pageIndex.json'), {
    pages: pageIds.map((pageId) => ({
      id: pageId,
      title: pageId,
      type: 'canvas',
      path: `pages/${pageId}.json`,
      categories: [],
      descriptors: []
    }))
  });
  await writeJson(path.join(vaultRoot, 'navigation.json'), {
    version: 3,
    folders: [],
    items: pageIds,
    pageStates: {},
    bindings: []
  });
  await Promise.all(pageIds.map((pageId) => writeJson(
    path.join(vaultRoot, `pages/${pageId}.json`),
    {
      id: pageId,
      title: pageId,
      type: 'canvas',
      categories: [],
      descriptors: {},
      objects: [],
      maintenanceResources: [],
      externalLinks: [],
      blocks: [],
      backlinks: []
    }
  )));
  await writeJson(path.join(vaultRoot, 'workspaceState.json'), {
    schemaVersion: 1,
    ...(topLevel === undefined ? {} : { lastOpenedPageId: topLevel }),
    workspaceState: {
      searchText: 'preserve me',
      ...(nested === undefined ? {} : { lastOpenedPageId: nested }),
      pageViewStates: Object.fromEntries(pageIds.map((pageId, index) => [
        pageId,
        { panX: index + 1 }
      ]))
    }
  });
  return vaultRoot;
}

function closeServer(server) {
  if (!server?.vaultServerContext) return Promise.resolve();
  return server.vaultServerContext.close();
}

function origin(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

async function start(vaultRoot) {
  const context = createVaultServerContext({
    appRoot: APP_ROOT,
    vaultId: path.basename(vaultRoot),
    vaultRoot
  });
  return context.start({ port: 0, host: '127.0.0.1' });
}

async function project(server) {
  const response = await fetch(`${origin(server)}/api/project`);
  assert.equal(response.status, 200);
  return response.json();
}

async function persistedWorkspace(vaultRoot) {
  return JSON.parse(await fs.readFile(path.join(vaultRoot, 'workspaceState.json'), 'utf8'));
}

function assertSingleOwner(state, expectedPageId) {
  assert.equal(state.lastOpenedPageId, expectedPageId);
  assert.equal(Object.hasOwn(state.workspaceState || {}, 'lastOpenedPageId'), false);
}

test('valid canonical Page wins migration, Page open survives workspace flush and restart', async () => {
  const vaultRoot = await seedVault({ topLevel: 'page_b', nested: 'page_a' });
  let server = await start(vaultRoot);
  try {
    assert.equal((await project(server)).lastOpenedPageId, 'page_b');
    assertSingleOwner(await persistedWorkspace(vaultRoot), 'page_b');

    const opened = await fetch(`${origin(server)}/api/project`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastOpenedPageId: 'page_a' })
    });
    assert.equal(opened.status, 200);
    assert.equal((await opened.json()).lastOpenedPageId, 'page_a');

    await updateVaultWorkspaceState(vaultRoot, (state) => ({
      ...state,
      workspaceState: {
        searchText: 'flushed immediately after Page open',
        lastOpenedPageId: 'page_b',
        pageViewStates: state.workspaceState.pageViewStates
      }
    }));
    const afterFlush = await persistedWorkspace(vaultRoot);
    assertSingleOwner(afterFlush, 'page_a');
    assert.equal(afterFlush.workspaceState.searchText, 'flushed immediately after Page open');

    await closeServer(server);
    server = await start(vaultRoot);
    assert.equal((await project(server)).lastOpenedPageId, 'page_a');
    assertSingleOwner(await persistedWorkspace(vaultRoot), 'page_a');
  } finally {
    await closeServer(server);
  }
});

test('legacy fallback promotes once and Page deletion changes only the canonical owner', async () => {
  const vaultRoot = await seedVault({ nested: 'page_b' });
  const server = await start(vaultRoot);
  try {
    assert.equal((await project(server)).lastOpenedPageId, 'page_b');
    assertSingleOwner(await persistedWorkspace(vaultRoot), 'page_b');

    const deleteNonCanonical = await fetch(`${origin(server)}/api/pages/page_a`, {
      method: 'DELETE'
    });
    assert.equal(deleteNonCanonical.status, 200);
    assert.equal((await deleteNonCanonical.json()).project.lastOpenedPageId, 'page_b');
    let state = await persistedWorkspace(vaultRoot);
    assertSingleOwner(state, 'page_b');
    assert.equal(Object.hasOwn(state.workspaceState.pageViewStates, 'page_a'), false);

    const deleteCanonical = await fetch(`${origin(server)}/api/pages/page_b`, {
      method: 'DELETE'
    });
    assert.equal(deleteCanonical.status, 200);
    const deleted = await deleteCanonical.json();
    assert.equal(deleted.fallbackPageId, 'page_c');
    assert.equal(deleted.project.lastOpenedPageId, 'page_c');
    state = await persistedWorkspace(vaultRoot);
    assertSingleOwner(state, 'page_c');
    assert.equal(Object.hasOwn(state.workspaceState.pageViewStates, 'page_b'), false);
  } finally {
    await closeServer(server);
  }
});

test('invalid copies and a new Vault keep the established null fallback', async () => {
  const invalidVault = await seedVault({ topLevel: 'page_missing', nested: 'also_missing' });
  const invalidServer = await start(invalidVault);
  try {
    assert.equal((await project(invalidServer)).lastOpenedPageId, null);
    assertSingleOwner(await persistedWorkspace(invalidVault), null);
  } finally {
    await closeServer(invalidServer);
  }

  const emptyVault = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-last-opened-empty-'));
  await createEmptyVault(emptyVault, vaultMetadata({
    vaultId: 'vault_empty_last_opened',
    displayName: 'Empty Last Opened',
    now: '2026-08-30T00:00:00.000Z'
  }), {});
  const emptyServer = await start(emptyVault);
  try {
    assert.equal((await project(emptyServer)).lastOpenedPageId, null);
    assertSingleOwner(await persistedWorkspace(emptyVault), null);
  } finally {
    await closeServer(emptyServer);
  }
});
