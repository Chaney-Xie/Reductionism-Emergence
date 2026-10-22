const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createEmptyVault, vaultMetadata } = require('../server/vaultContext');
const { createVaultServerContext } = require('../server/appServer');

const APP_ROOT = path.join(__dirname, '..');

function createContext(vaultRoot, vaultId) {
  return createVaultServerContext({
    appRoot: APP_ROOT,
    vaultId,
    vaultRoot
  });
}

function serverOrigin(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

async function readAppearance(server) {
  const response = await fetch(`${serverOrigin(server)}/api/appearance`);
  assert.equal(response.status, 200);
  return response.json();
}

async function saveAppearance(server, appearance) {
  return fetch(`${serverOrigin(server)}/api/appearance`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(appearance)
  });
}

async function seedBindingPages(vaultRoot) {
  const pageIds = ['page_a', 'page_b'];
  await fs.writeFile(path.join(vaultRoot, 'pageIndex.json'), `${JSON.stringify({
    pages: pageIds.map((pageId) => ({
      id: pageId,
      title: pageId,
      path: `pages/${pageId}.json`,
      categories: ['category_plain'],
      descriptors: []
    }))
  }, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(vaultRoot, 'navigation.json'), `${JSON.stringify({
    version: 3,
    folders: [],
    items: pageIds,
    pageStates: {},
    bindings: []
  }, null, 2)}\n`, 'utf8');
  await Promise.all(pageIds.map((pageId) => fs.writeFile(
    path.join(vaultRoot, `pages/${pageId}.json`),
    `${JSON.stringify({
      id: pageId,
      title: pageId,
      categories: ['category_plain'],
      descriptors: {},
      objects: [],
      maintenanceResources: [],
      blocks: [],
      backlinks: []
    }, null, 2)}\n`,
    'utf8'
  )));
}

async function bindPages(server, selectedPageIds, leaderPageId) {
  return fetch(`${serverOrigin(server)}/api/navigation/bindings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selectedPageIds, leaderPageId })
  });
}

async function readNavigation(server) {
  const response = await fetch(`${serverOrigin(server)}/api/navigation`);
  assert.equal(response.status, 200);
  return response.json();
}

test('isolated window servers bind reads and writes to their own Vault roots', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-window-vaults-'));
  const firstRoot = path.join(root, 'Alpha');
  const secondRoot = path.join(root, 'Beta');
  await Promise.all([
    createEmptyVault(firstRoot, vaultMetadata({
      vaultId: 'vault_alpha', displayName: 'Alpha', now: '2026-08-02T00:00:00.000Z'
    }), {}),
    createEmptyVault(secondRoot, vaultMetadata({
      vaultId: 'vault_beta', displayName: 'Beta', now: '2026-08-02T00:00:00.000Z'
    }), {})
  ]);
  const firstContext = createContext(firstRoot, 'vault_alpha');
  const secondContext = createContext(secondRoot, 'vault_beta');
  assert.notStrictEqual(firstContext, secondContext);
  assert.notStrictEqual(firstContext.app, secondContext.app);
  assert.equal(firstContext.vaultRoot, firstRoot);
  assert.equal(secondContext.vaultRoot, secondRoot);
  assert.equal(firstContext.vaultId, 'vault_alpha');
  assert.equal(secondContext.vaultId, 'vault_beta');
  const [firstServer, secondServer] = await Promise.all([
    firstContext.start({ port: 0, host: '127.0.0.1' }),
    secondContext.start({ port: 0, host: '127.0.0.1' })
  ]);
  assert.notEqual(firstServer.address().port, secondServer.address().port);
  assert.strictEqual(firstServer.vaultServerContext, firstContext);
  assert.strictEqual(secondServer.vaultServerContext, secondContext);
  const origin = (server) => `http://127.0.0.1:${server.address().port}`;
  try {
    const [alpha, beta] = await Promise.all([
      fetch(`${origin(firstServer)}/api/project`).then((response) => response.json()),
      fetch(`${origin(secondServer)}/api/project`).then((response) => response.json())
    ]);
    assert.equal(alpha.projectId, 'vault_alpha');
    assert.equal(beta.projectId, 'vault_beta');

    const changed = { ...alpha.appearance, accentColour: '#123456' };
    const saved = await fetch(`${origin(firstServer)}/api/appearance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changed)
    }).then((response) => response.json());
    const untouched = await fetch(`${origin(secondServer)}/api/appearance`)
      .then((response) => response.json());
    assert.equal(saved.accentColour, '#123456');
    assert.notEqual(untouched.accentColour, '#123456');
    assert.equal(JSON.parse(await fs.readFile(path.join(secondRoot, 'appearance.json'), 'utf8')), null);
  } finally {
    await Promise.all([firstContext.close(), secondContext.close()]);
  }
});

test('Page Bindings persist across restart and remain isolated between simultaneous Vault servers', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-window-page-bindings-'));
  const alphaRoot = path.join(root, 'Alpha');
  const betaRoot = path.join(root, 'Beta');
  await Promise.all([
    createEmptyVault(alphaRoot, vaultMetadata({
      vaultId: 'vault_binding_alpha', displayName: 'Binding Alpha', now: '2026-08-24T00:00:00.000Z'
    }), {}),
    createEmptyVault(betaRoot, vaultMetadata({
      vaultId: 'vault_binding_beta', displayName: 'Binding Beta', now: '2026-08-24T00:00:00.000Z'
    }), {})
  ]);
  await Promise.all([seedBindingPages(alphaRoot), seedBindingPages(betaRoot)]);

  const create = (vaultRoot, vaultId) => createContext(vaultRoot, vaultId);
  let contexts = [
    create(alphaRoot, 'vault_binding_alpha'),
    create(betaRoot, 'vault_binding_beta')
  ];
  let servers = await Promise.all(contexts.map((context) => (
    context.start({ port: 0, host: '127.0.0.1' })
  )));
  try {
    const [alphaResponse, betaResponse] = await Promise.all([
      bindPages(servers[0], ['page_b'], 'page_a'),
      bindPages(servers[1], ['page_a'], 'page_b')
    ]);
    assert.equal(alphaResponse.status, 200);
    assert.equal(betaResponse.status, 200);
    const alphaCreated = await alphaResponse.json();
    const betaCreated = await betaResponse.json();
    assert.equal(alphaCreated.navigation.bindings[0].leaderPageId, 'page_a');
    assert.equal(betaCreated.navigation.bindings[0].leaderPageId, 'page_b');
    const alphaBindingId = alphaCreated.navigation.bindings[0].id;
    const betaBindingId = betaCreated.navigation.bindings[0].id;

    const [alphaOnDisk, betaOnDisk] = await Promise.all([
      fs.readFile(path.join(alphaRoot, 'navigation.json'), 'utf8').then(JSON.parse),
      fs.readFile(path.join(betaRoot, 'navigation.json'), 'utf8').then(JSON.parse)
    ]);
    assert.equal(alphaOnDisk.bindings[0].leaderPageId, 'page_a');
    assert.equal(betaOnDisk.bindings[0].leaderPageId, 'page_b');
    assert.equal(alphaOnDisk.bindings[0].id, alphaBindingId);
    assert.equal(betaOnDisk.bindings[0].id, betaBindingId);
    assert.deepEqual(alphaOnDisk.items, ['page_a']);
    assert.deepEqual(betaOnDisk.items, ['page_b']);

    await contexts[0].close();
    assert.equal((await readNavigation(servers[1])).bindings[0].id, betaBindingId,
      'closing Alpha leaves the independently owned Beta server live');
    contexts[0] = create(alphaRoot, 'vault_binding_alpha');
    servers[0] = await contexts[0].start({ port: 0, host: '127.0.0.1' });
    assert.equal((await readNavigation(servers[1])).bindings[0].leaderPageId, 'page_b',
      'reconstructing Alpha does not disturb Beta');

    await Promise.all(contexts.map((context) => context.close()));
    contexts = [
      create(alphaRoot, 'vault_binding_alpha'),
      create(betaRoot, 'vault_binding_beta')
    ];
    servers = await Promise.all(contexts.map((context) => (
      context.start({ port: 0, host: '127.0.0.1' })
    )));
    const [alphaRestarted, betaRestarted] = await Promise.all(servers.map(readNavigation));
    assert.equal(alphaRestarted.bindings[0].leaderPageId, 'page_a');
    assert.equal(alphaRestarted.bindings[0].id, alphaBindingId);
    assert.deepEqual(alphaRestarted.bindings[0].followerPageIds, ['page_b']);
    assert.deepEqual(alphaRestarted.items, ['page_a']);
    assert.equal(betaRestarted.bindings[0].leaderPageId, 'page_b');
    assert.equal(betaRestarted.bindings[0].id, betaBindingId);
    assert.deepEqual(betaRestarted.bindings[0].followerPageIds, ['page_a']);
    assert.deepEqual(betaRestarted.items, ['page_b']);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('Markdown colours persist and reset independently across isolated Vault servers', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-window-markdown-colours-'));
  const alphaRoot = path.join(root, 'Alpha');
  const betaRoot = path.join(root, 'Beta');
  await Promise.all([
    createEmptyVault(alphaRoot, vaultMetadata({
      vaultId: 'vault_markdown_alpha', displayName: 'Markdown Alpha', now: '2026-08-24T00:00:00.000Z'
    }), {}),
    createEmptyVault(betaRoot, vaultMetadata({
      vaultId: 'vault_markdown_beta', displayName: 'Markdown Beta', now: '2026-08-24T00:00:00.000Z'
    }), {})
  ]);

  const createVault = (vaultRoot, vaultId) => createContext(vaultRoot, vaultId);
  let contexts = [
    createVault(alphaRoot, 'vault_markdown_alpha'),
    createVault(betaRoot, 'vault_markdown_beta')
  ];
  const startContexts = () => Promise.all(contexts.map((context) => (
    context.start({ port: 0, host: '127.0.0.1' })
  )));
  let servers = await startContexts();
  t.after(async () => Promise.all(contexts.map((context) => context.close())));

  const replaceContexts = () => {
    contexts = [
      createVault(alphaRoot, 'vault_markdown_alpha'),
      createVault(betaRoot, 'vault_markdown_beta')
    ];
  };

  const [alphaDefaults, betaDefaults] = await Promise.all(servers.map(readAppearance));
  const alphaAppearance = {
    ...alphaDefaults,
    markdownColours: {
      ...alphaDefaults.markdownColours,
      headingMode: 'by-level',
      headings: {
        ...alphaDefaults.markdownColours.headings,
        h1: '#112233',
        h4: '#223344'
      },
      text: {
        ...alphaDefaults.markdownColours.text,
        bold: '#334455',
        boldItalic: '#445566',
        strikethroughLine: '#556677'
      },
      code: { background: '#DDEEFF', border: null },
      symbols: { group1: '#667788', group2: '#778899' }
    }
  };
  const betaAppearance = {
    ...betaDefaults,
    markdownColours: {
      ...betaDefaults.markdownColours,
      headingMode: 'unified',
      headings: {
        ...betaDefaults.markdownColours.headings,
        unified: '#AABBCC'
      },
      text: {
        ...betaDefaults.markdownColours.text,
        bold: '#8899AA',
        italic: '#99AABB',
        underlineLine: '#AABBCC',
        hyperlink: '#BBCCDD'
      },
      code: { background: null, border: '#102030' },
      symbols: { group1: '#203040', group2: '#304050' }
    }
  };

  const [alphaSave, betaSave] = await Promise.all([
    saveAppearance(servers[0], alphaAppearance),
    saveAppearance(servers[1], betaAppearance)
  ]);
  assert.equal(alphaSave.status, 200);
  assert.equal(betaSave.status, 200);
  assert.deepEqual(await alphaSave.json(), alphaAppearance);
  assert.deepEqual(await betaSave.json(), betaAppearance);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(alphaRoot, 'appearance.json'), 'utf8')),
    alphaAppearance
  );
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(betaRoot, 'appearance.json'), 'utf8')),
    betaAppearance
  );

  const alphaReset = {
    ...alphaAppearance,
    markdownColours: {
      ...alphaAppearance.markdownColours,
      text: { ...alphaAppearance.markdownColours.text, bold: null }
    }
  };
  const alphaResetResponse = await saveAppearance(servers[0], alphaReset);
  assert.equal(alphaResetResponse.status, 200);
  assert.deepEqual(await alphaResetResponse.json(), alphaReset);
  assert.equal((await readAppearance(servers[0])).markdownColours.text.bold, null);
  assert.equal((await readAppearance(servers[0])).markdownColours.headings.h1, '#112233');
  assert.equal((await readAppearance(servers[1])).markdownColours.text.bold, '#8899AA');

  const alphaAppearancePath = path.join(alphaRoot, 'appearance.json');
  const alphaBytesBeforeInvalidSave = await fs.readFile(alphaAppearancePath, 'utf8');
  const invalidAppearance = {
    ...alphaReset,
    markdownColours: {
      ...alphaReset.markdownColours,
      text: { ...alphaReset.markdownColours.text, hyperlink: 'not-a-colour' }
    }
  };
  const invalidResponse = await saveAppearance(servers[0], invalidAppearance);
  assert.equal(invalidResponse.status, 400);
  assert.match((await invalidResponse.json()).error, /six-digit HEX/i);
  assert.equal(await fs.readFile(alphaAppearancePath, 'utf8'), alphaBytesBeforeInvalidSave);
  assert.deepEqual(await readAppearance(servers[1]), betaAppearance);

  await Promise.all(contexts.map((context) => context.close()));
  replaceContexts();
  servers = await startContexts();
  assert.deepEqual(await readAppearance(servers[0]), alphaReset);
  assert.deepEqual(await readAppearance(servers[1]), betaAppearance);
});
