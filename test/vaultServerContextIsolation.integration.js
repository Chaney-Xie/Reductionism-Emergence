const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createVaultServerContext } = require('../server/appServer');
const { createEmptyVault, vaultMetadata } = require('../server/vaultContext');

const APP_ROOT = path.resolve(__dirname, '..');
const ISOLATION_TIMEOUT_MS = 5000;
const SHARED_PAGE_ID = 'page_shared';
const PEER_PAGE_ID = 'page_peer';
const SHARED_RESOURCE_LOCATION = Object.freeze({
  type: 'folder',
  folderId: 'folder_shared',
  relativePath: 'same.txt'
});
const FAILED_RESOURCE_LOCATION = Object.freeze({
  type: 'folder',
  folderId: 'folder_shared',
  relativePath: 'fail.txt'
});
const SHARED_WORKSPACE_LOCATION = Object.freeze({
  type: 'workspace',
  workspaceId: 'workspace_shared',
  relativePath: 'workspace.txt'
});
const SHARED_VAULT_ASSET_LOCATION = Object.freeze({
  type: 'vault',
  relativePath: 'assets/resources/shared-vault.txt'
});

function origin(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function requestJson(server, pathname, options = {}) {
  const response = await fetch(`${origin(server)}${pathname}`, options);
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function expectJson(server, pathname, options, expectedStatus = 200) {
  const result = await requestJson(server, pathname, options);
  assert.equal(result.response.status, expectedStatus, JSON.stringify(result.body));
  return result.body;
}

async function within(promise, milliseconds, message) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function permissionDenied(filePath, syscall) {
  return Object.assign(
    new Error(`EACCES: permission denied, ${syscall} '${filePath}'`),
    {
      code: 'EACCES',
      errno: -13,
      path: filePath,
      syscall
    }
  );
}

function pageRecord(id, title, maintenanceResources = [], {
  categories = [],
  externalLinks = []
} = {}) {
  return {
    id,
    title,
    type: 'canvas',
    categories,
    descriptors: {},
    ignoredDescriptors: {},
    ignoredManualEntryIds: [],
    objects: [],
    maintenanceResources,
    blocks: [],
    backlinks: [],
    highlightGroups: [],
    externalLinks
  };
}

async function seedVault(vaultRoot, {
  vaultId,
  displayName,
  resourceContents,
  categoryId,
  categoryLabel,
  externalUrl,
  vaultAssetContents
}) {
  const timestamp = '2026-09-19T00:00:00.000Z';
  await createEmptyVault(vaultRoot, vaultMetadata({
    vaultId,
    displayName,
    now: timestamp
  }), {});

  const resourcesRoot = path.join(vaultRoot, 'external-resources');
  await fs.mkdir(resourcesRoot, { recursive: true });
  await Promise.all(Object.entries(resourceContents).map(([name, contents]) => (
    fs.writeFile(path.join(resourcesRoot, name), contents, 'utf8')
  )));
  await fs.writeFile(
    path.join(vaultRoot, 'assets', 'resources', 'shared-vault.txt'),
    vaultAssetContents,
    'utf8'
  );

  const sharedResources = [{
    id: 'resource_shared',
    type: 'file',
    resourceType: 'text',
    originalName: 'same.txt',
    fileName: 'same.txt',
    mimeType: 'text/plain',
    displayable: false,
    size: Buffer.byteLength(resourceContents['same.txt']),
    location: SHARED_RESOURCE_LOCATION
  }, {
    id: 'resource_fail',
    type: 'file',
    resourceType: 'text',
    originalName: 'fail.txt',
    fileName: 'fail.txt',
    mimeType: 'text/plain',
    displayable: false,
    size: Buffer.byteLength(resourceContents['fail.txt']),
    location: FAILED_RESOURCE_LOCATION
  }, {
    id: 'resource_workspace_shared',
    type: 'file',
    resourceType: 'text',
    originalName: 'workspace.txt',
    fileName: 'workspace.txt',
    mimeType: 'text/plain',
    displayable: false,
    size: Buffer.byteLength(resourceContents['workspace.txt']),
    location: SHARED_WORKSPACE_LOCATION
  }, {
    id: 'resource_vault_asset_shared',
    type: 'file',
    resourceType: 'text',
    originalName: 'shared-vault.txt',
    fileName: 'shared-vault.txt',
    mimeType: 'text/plain',
    displayable: false,
    size: Buffer.byteLength(vaultAssetContents),
    location: SHARED_VAULT_ASSET_LOCATION
  }];
  const pages = [
    pageRecord(SHARED_PAGE_ID, `${displayName} shared`, sharedResources, {
      categories: [categoryId],
      externalLinks: [{
        id: 'external_shared',
        displayName: 'Shared external target',
        targetKind: 'url',
        url: externalUrl,
        sourceBlockId: null
      }]
    }),
    pageRecord(PEER_PAGE_ID, `${displayName} peer`)
  ];
  await Promise.all(pages.map((page) => writeJson(
    path.join(vaultRoot, 'pages', `${page.id}.json`),
    page
  )));
  await writeJson(path.join(vaultRoot, 'pageIndex.json'), {
    metadataRevision: 0,
    pages: pages.map((page) => ({
      id: page.id,
      title: page.title,
      type: page.type,
      path: `pages/${page.id}.json`,
      categories: page.categories,
      categoryIds: page.categories,
      descriptors: {},
      descriptorIds: []
    }))
  });
  await writeJson(path.join(vaultRoot, 'navigation.json'), {
    version: 3,
    folders: [],
    items: [SHARED_PAGE_ID, PEER_PAGE_ID],
    pageStates: {},
    bindings: []
  });
  await writeJson(path.join(vaultRoot, 'categories.json'), {
    navigation: {
      enabledCategoryIds: [],
      collapseUncategorisedPages: false,
      quantityStatistics: false
    },
    groups: [{
      id: 'group_shared_label',
      label: 'Shared Folder Label',
      children: [{ type: 'item', id: categoryId, label: categoryLabel }]
    }]
  });
  return resourcesRoot;
}

function jsonOptions(method, body, headers = {}) {
  return {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  };
}

test('Vault server context construction requires explicit identity and roots', () => {
  assert.throws(
    () => createVaultServerContext(),
    /Vault ID is required/
  );
  assert.throws(
    () => createVaultServerContext({ vaultId: 'vault_explicit' }),
    /Application root is required/
  );
  assert.throws(
    () => createVaultServerContext({ vaultId: 'vault_explicit', appRoot: APP_ROOT }),
    /Vault root is required/
  );
});

test('two explicit Vault server contexts from one import isolate state, services, queues, and disposal', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-context-isolation-'));
  const alphaRoot = path.join(temporaryRoot, 'Alpha');
  const betaRoot = path.join(temporaryRoot, 'Beta');
  const [alphaResources, betaResources] = await Promise.all([
    seedVault(alphaRoot, {
      vaultId: 'vault_alpha',
      displayName: 'Alpha',
      resourceContents: {
        'same.txt': 'alpha-resource',
        'fail.txt': 'alpha-failure-source',
        'slow.txt': 'alpha-slow-resource',
        'workspace.txt': 'alpha-workspace-resource'
      },
      categoryId: 'category_alpha',
      categoryLabel: 'Alpha Category',
      externalUrl: 'https://alpha.example.test/resource',
      vaultAssetContents: 'alpha-vault-asset'
    }),
    seedVault(betaRoot, {
      vaultId: 'vault_beta',
      displayName: 'Beta',
      resourceContents: {
        'same.txt': 'beta-resource',
        'fail.txt': 'beta-healthy-source',
        'slow.txt': 'beta-slow-resource',
        'workspace.txt': 'beta-workspace-resource'
      },
      categoryId: 'category_beta',
      categoryLabel: 'Beta Category',
      externalUrl: 'https://beta.example.test/resource',
      vaultAssetContents: 'beta-vault-asset'
    })
  ]);

  const alphaProxyPath = path.join(temporaryRoot, 'alpha-proxy.txt');
  const betaProxyPath = path.join(temporaryRoot, 'beta-proxy.txt');
  await Promise.all([
    fs.writeFile(alphaProxyPath, 'alpha-proxy', 'utf8'),
    fs.writeFile(betaProxyPath, 'beta-proxy', 'utf8')
  ]);

  const alphaSlowEntered = deferred();
  const releaseAlphaSlow = deferred();
  const resolverCalls = { alpha: [], beta: [] };
  const resolvedResourcePath = (vaultRoot, resourcesRoot, location) => {
    const root = location.type === 'vault' ? vaultRoot : resourcesRoot;
    const absolutePath = path.resolve(root, location.relativePath);
    assert.ok(absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`));
    return absolutePath;
  };
  const proxyCalls = { alpha: [], beta: [] };
  const alphaResolver = async (location) => {
    resolverCalls.alpha.push({ ...location });
    if (location.relativePath === 'fail.txt') {
      const error = new Error('Alpha resolver is intentionally unavailable.');
      error.code = 'WORKSPACE_UNAVAILABLE';
      throw error;
    }
    if (location.relativePath === 'slow.txt') {
      alphaSlowEntered.resolve();
      await releaseAlphaSlow.promise;
    }
    return { absolutePath: resolvedResourcePath(alphaRoot, alphaResources, location) };
  };
  const betaResolver = async (location) => {
    resolverCalls.beta.push({ ...location });
    return { absolutePath: resolvedResourcePath(betaRoot, betaResources, location) };
  };
  const proxyService = (owner, absolutePath, contents) => ({
    async prepareContent(fingerprint, tier) {
      proxyCalls[owner].push({ fingerprint, tier });
      return {
        absolutePath,
        mimeType: 'text/plain',
        size: Buffer.byteLength(contents)
      };
    }
  });
  const alphaToken = 'alpha-desktop-token-123456';
  const betaToken = 'beta-desktop-token-1234567';
  const alphaContext = createVaultServerContext({
    appRoot: APP_ROOT,
    vaultId: 'vault_alpha',
    vaultRoot: alphaRoot,
    resourceResolver: alphaResolver,
    displayProxyService: proxyService('alpha', alphaProxyPath, 'alpha-proxy'),
    desktopMutationToken: alphaToken
  });
  const betaContext = createVaultServerContext({
    appRoot: APP_ROOT,
    vaultId: 'vault_beta',
    vaultRoot: betaRoot,
    resourceResolver: betaResolver,
    displayProxyService: proxyService('beta', betaProxyPath, 'beta-proxy'),
    desktopMutationToken: betaToken
  });
  let alphaServer = null;
  let betaServer = null;
  let reboundAlphaContext = null;
  t.after(async () => {
    releaseAlphaSlow.resolve();
    await Promise.allSettled([
      alphaContext.close(),
      betaContext.close(),
      reboundAlphaContext?.close()
    ]);
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  assert.notEqual(alphaContext, betaContext);
  assert.notEqual(alphaContext.app, betaContext.app);
  assert.equal(alphaContext.vaultId, 'vault_alpha');
  assert.equal(betaContext.vaultId, 'vault_beta');
  assert.equal(alphaContext.vaultRoot, path.resolve(alphaRoot));
  assert.equal(betaContext.vaultRoot, path.resolve(betaRoot));

  [alphaServer, betaServer] = await Promise.all([
    alphaContext.start({ port: 0, host: '127.0.0.1' }),
    betaContext.start({ port: 0, host: '127.0.0.1' })
  ]);
  assert.equal(alphaContext.server, alphaServer);
  assert.equal(betaContext.server, betaServer);
  assert.notEqual(alphaServer.address().port, betaServer.address().port);
  await assert.rejects(
    alphaContext.start({ port: 0, host: '127.0.0.1' }),
    /already running/
  );

  const [alphaProject, betaProject] = await Promise.all([
    expectJson(alphaServer, '/api/project'),
    expectJson(betaServer, '/api/project')
  ]);
  assert.equal(alphaProject.projectId, 'vault_alpha');
  assert.equal(betaProject.projectId, 'vault_beta');

  const sharedContentPath = `/api/pages/${SHARED_PAGE_ID}/resources/resource_shared/content`;
  const failedContentPath = `/api/pages/${SHARED_PAGE_ID}/resources/resource_fail/content`;
  const workspaceContentPath =
    `/api/pages/${SHARED_PAGE_ID}/resources/resource_workspace_shared/content`;
  const vaultAssetContentPath =
    `/api/pages/${SHARED_PAGE_ID}/resources/resource_vault_asset_shared/content`;
  const [alphaContent, betaContent, alphaWorkspaceContent, betaWorkspaceContent,
    alphaVaultAsset, betaVaultAsset, alphaProxy, betaProxy] = await Promise.all([
    fetch(`${origin(alphaServer)}${sharedContentPath}`),
    fetch(`${origin(betaServer)}${sharedContentPath}`),
    fetch(`${origin(alphaServer)}${workspaceContentPath}`),
    fetch(`${origin(betaServer)}${workspaceContentPath}`),
    fetch(`${origin(alphaServer)}${vaultAssetContentPath}`),
    fetch(`${origin(betaServer)}${vaultAssetContentPath}`),
    fetch(`${origin(alphaServer)}/api/display-proxies/shared-fingerprint/1024`),
    fetch(`${origin(betaServer)}/api/display-proxies/shared-fingerprint/1024`)
  ]);
  assert.equal(alphaContent.status, 200);
  assert.equal(betaContent.status, 200);
  assert.equal(await alphaContent.text(), 'alpha-resource');
  assert.equal(await betaContent.text(), 'beta-resource');
  assert.equal(alphaWorkspaceContent.status, 200);
  assert.equal(betaWorkspaceContent.status, 200);
  assert.equal(await alphaWorkspaceContent.text(), 'alpha-workspace-resource');
  assert.equal(await betaWorkspaceContent.text(), 'beta-workspace-resource');
  assert.equal(alphaVaultAsset.status, 200);
  assert.equal(betaVaultAsset.status, 200);
  assert.equal(await alphaVaultAsset.text(), 'alpha-vault-asset');
  assert.equal(await betaVaultAsset.text(), 'beta-vault-asset');
  assert.equal(alphaProxy.status, 200);
  assert.equal(betaProxy.status, 200);
  assert.equal(await alphaProxy.text(), 'alpha-proxy');
  assert.equal(await betaProxy.text(), 'beta-proxy');
  assert.deepEqual(proxyCalls, {
    alpha: [{ fingerprint: 'shared-fingerprint', tier: '1024' }],
    beta: [{ fingerprint: 'shared-fingerprint', tier: '1024' }]
  });

  const [alphaFailure, betaHealthy] = await Promise.all([
    requestJson(alphaServer, failedContentPath),
    fetch(`${origin(betaServer)}${failedContentPath}`)
  ]);
  assert.equal(alphaFailure.response.status, 503);
  assert.match(alphaFailure.body.error, /Alpha resolver/);
  assert.equal(betaHealthy.status, 200);
  assert.equal(await betaHealthy.text(), 'beta-healthy-source');

  const alphaSlowMutation = fetch(
    `${origin(alphaServer)}/api/pages/${SHARED_PAGE_ID}/add-files`,
    jsonOptions('POST', {
      files: [{
        location: {
          type: 'folder',
          folderId: 'folder_shared',
          relativePath: 'slow.txt'
        }
      }]
    }, { 'x-viewer-desktop-token': alphaToken })
  );
  await within(
    alphaSlowEntered.promise,
    ISOLATION_TIMEOUT_MS,
    'Vault A did not enter its intentionally blocked resource mutation.'
  );

  const betaMutationWhileAlphaBlocked = within(
    requestJson(
      betaServer,
      `/api/pages/${SHARED_PAGE_ID}`,
      jsonOptions('POST', { title: 'Beta changed while Alpha was blocked' })
    ),
    ISOLATION_TIMEOUT_MS,
    'Vault B was blocked by Vault A\'s request queue.'
  );
  const betaMutationResult = await betaMutationWhileAlphaBlocked;
  assert.equal(betaMutationResult.response.status, 200, JSON.stringify(betaMutationResult.body));
  assert.equal(betaMutationResult.body.page.title, 'Beta changed while Alpha was blocked');

  releaseAlphaSlow.resolve();
  const alphaSlowResponse = await alphaSlowMutation;
  assert.equal(alphaSlowResponse.status, 200, await alphaSlowResponse.text());

  const [alphaCrossToken, betaCrossToken] = await Promise.all([
    requestJson(
      alphaServer,
      `/api/pages/${SHARED_PAGE_ID}/add-files`,
      jsonOptions('POST', { files: [] }, { 'x-viewer-desktop-token': betaToken })
    ),
    requestJson(
      betaServer,
      `/api/pages/${SHARED_PAGE_ID}/add-files`,
      jsonOptions('POST', { files: [] }, { 'x-viewer-desktop-token': alphaToken })
    )
  ]);
  assert.equal(alphaCrossToken.response.status, 403);
  assert.equal(betaCrossToken.response.status, 403);

  const sharedDescriptorInput = {
    class_1: [{ display: 'Shared Context Descriptor' }],
    class_2: [],
    class_3: []
  };
  const emptyIgnoredDescriptors = { class_1: [], class_2: [], class_3: [] };
  const [alphaSharedDescriptorSave, betaSharedDescriptorSave] = await Promise.all([
    requestJson(
      alphaServer,
      `/api/pages/${SHARED_PAGE_ID}`,
      jsonOptions('POST', {
        descriptors: sharedDescriptorInput,
        ignoredDescriptors: emptyIgnoredDescriptors
      })
    ),
    requestJson(
      betaServer,
      `/api/pages/${SHARED_PAGE_ID}`,
      jsonOptions('POST', {
        descriptors: sharedDescriptorInput,
        ignoredDescriptors: emptyIgnoredDescriptors
      })
    )
  ]);
  assert.equal(
    alphaSharedDescriptorSave.response.status,
    200,
    JSON.stringify(alphaSharedDescriptorSave.body)
  );
  assert.equal(
    betaSharedDescriptorSave.response.status,
    200,
    JSON.stringify(betaSharedDescriptorSave.body)
  );
  const alphaSharedDescriptor = alphaSharedDescriptorSave.body.page.descriptors.class_1[0];
  const betaSharedDescriptor = betaSharedDescriptorSave.body.page.descriptors.class_1[0];
  assert.equal(alphaSharedDescriptor.entryId, betaSharedDescriptor.entryId);
  const [alphaSharedMetadata, betaSharedMetadata] = await Promise.all([
    expectJson(alphaServer, '/api/descriptor-metadata/snapshot'),
    expectJson(betaServer, '/api/descriptor-metadata/snapshot')
  ]);
  const alphaSharedRegistryEntry = alphaSharedMetadata.descriptorRegistry.entries
    .find((entry) => entry.id === alphaSharedDescriptor.entryId);
  const betaSharedRegistryEntry = betaSharedMetadata.descriptorRegistry.entries
    .find((entry) => entry.id === betaSharedDescriptor.entryId);
  assert.equal(alphaSharedRegistryEntry.display, 'Shared Context Descriptor');
  assert.equal(betaSharedRegistryEntry.display, 'Shared Context Descriptor');

  const [alphaAppearance, betaAppearance] = await Promise.all([
    expectJson(alphaServer, '/api/appearance'),
    expectJson(betaServer, '/api/appearance')
  ]);
  const bindingMutations = await Promise.all([
    requestJson(
      alphaServer,
      '/api/navigation/bindings',
      jsonOptions('POST', {
        selectedPageIds: [PEER_PAGE_ID],
        leaderPageId: SHARED_PAGE_ID
      })
    ),
    requestJson(
      betaServer,
      '/api/navigation/bindings',
      jsonOptions('POST', {
        selectedPageIds: [SHARED_PAGE_ID],
        leaderPageId: PEER_PAGE_ID
      })
    )
  ]);
  for (const mutation of bindingMutations) {
    assert.equal(mutation.response.status, 200, JSON.stringify(mutation.body));
  }
  const mutations = await Promise.all([
    requestJson(
      alphaServer,
      '/api/appearance',
      jsonOptions('PUT', { ...alphaAppearance, accentColour: '#112233' })
    ),
    requestJson(
      betaServer,
      '/api/appearance',
      jsonOptions('PUT', { ...betaAppearance, accentColour: '#AABBCC' })
    ),
    requestJson(
      alphaServer,
      '/api/vault-preferences',
      jsonOptions('PATCH', { lastMarkdownMode: 'source' })
    ),
    requestJson(
      betaServer,
      '/api/vault-preferences',
      jsonOptions('PATCH', { lastMarkdownMode: 'live-preview' })
    ),
    requestJson(
      alphaServer,
      '/api/categories/navigation',
      jsonOptions('PATCH', {
        enabledCategoryIds: ['category_alpha'],
        collapseUncategorisedPages: false,
        quantityStatistics: true
      })
    ),
    requestJson(
      betaServer,
      '/api/categories/navigation',
      jsonOptions('PATCH', {
        enabledCategoryIds: ['category_beta'],
        collapseUncategorisedPages: true,
        quantityStatistics: false
      })
    ),
    requestJson(
      alphaServer,
      '/api/project',
      jsonOptions('PATCH', { lastOpenedPageId: SHARED_PAGE_ID })
    ),
    requestJson(
      betaServer,
      '/api/project',
      jsonOptions('PATCH', { lastOpenedPageId: PEER_PAGE_ID })
    ),
    requestJson(
      alphaServer,
      `/api/pages/${SHARED_PAGE_ID}`,
      jsonOptions('POST', { title: 'Alpha final title' })
    )
  ]);
  for (const mutation of mutations) {
    assert.equal(mutation.response.status, 200, JSON.stringify(mutation.body));
  }

  const [alphaPage, betaPage, finalAlphaAppearance, finalBetaAppearance,
    alphaPreferences, betaPreferences, alphaNavigation, betaNavigation,
    alphaCategories, betaCategories, alphaFinalProject, betaFinalProject] = await Promise.all([
    expectJson(alphaServer, `/api/pages/${SHARED_PAGE_ID}`),
    expectJson(betaServer, `/api/pages/${SHARED_PAGE_ID}`),
    expectJson(alphaServer, '/api/appearance'),
    expectJson(betaServer, '/api/appearance'),
    expectJson(alphaServer, '/api/vault-preferences'),
    expectJson(betaServer, '/api/vault-preferences'),
    expectJson(alphaServer, '/api/navigation'),
    expectJson(betaServer, '/api/navigation'),
    expectJson(alphaServer, '/api/categories'),
    expectJson(betaServer, '/api/categories'),
    expectJson(alphaServer, '/api/project'),
    expectJson(betaServer, '/api/project')
  ]);
  assert.equal(alphaPage.title, 'Alpha final title');
  assert.equal(betaPage.title, 'Beta changed while Alpha was blocked');
  assert.equal(finalAlphaAppearance.accentColour, '#112233');
  assert.equal(finalBetaAppearance.accentColour, '#AABBCC');
  assert.equal(alphaPreferences.lastMarkdownMode, 'source');
  assert.equal(betaPreferences.lastMarkdownMode, 'live-preview');
  assert.deepEqual(alphaPage.categories, ['category_alpha']);
  assert.deepEqual(betaPage.categories, ['category_beta']);
  assert.equal(alphaPage.externalLinks[0].url, 'https://alpha.example.test/resource');
  assert.equal(betaPage.externalLinks[0].url, 'https://beta.example.test/resource');
  assert.equal(
    alphaPage.maintenanceResources.find((item) => item.id === 'resource_shared').fileName,
    'same.txt'
  );
  assert.equal(
    betaPage.maintenanceResources.find((item) => item.id === 'resource_shared').fileName,
    'same.txt'
  );
  assert.deepEqual(alphaCategories.navigation.enabledCategoryIds, ['category_alpha']);
  assert.deepEqual(betaCategories.navigation.enabledCategoryIds, ['category_beta']);
  assert.equal(alphaCategories.groups[0].children[0].label, 'Alpha Category');
  assert.equal(betaCategories.groups[0].children[0].label, 'Beta Category');
  assert.equal(alphaFinalProject.lastOpenedPageId, SHARED_PAGE_ID);
  assert.equal(betaFinalProject.lastOpenedPageId, PEER_PAGE_ID);
  assert.equal(alphaNavigation.bindings[0].leaderPageId, SHARED_PAGE_ID);
  assert.deepEqual(alphaNavigation.bindings[0].followerPageIds, [PEER_PAGE_ID]);
  assert.equal(betaNavigation.bindings[0].leaderPageId, PEER_PAGE_ID);
  assert.deepEqual(betaNavigation.bindings[0].followerPageIds, [SHARED_PAGE_ID]);

  const [alphaDiskPage, betaDiskPage, alphaDiskAppearance, betaDiskAppearance,
    alphaDiskCategories, betaDiskCategories, alphaDiskWorkspace, betaDiskWorkspace,
    alphaDiskVaultAsset, betaDiskVaultAsset] = await Promise.all([
    fs.readFile(path.join(alphaRoot, 'pages', `${SHARED_PAGE_ID}.json`), 'utf8').then(JSON.parse),
    fs.readFile(path.join(betaRoot, 'pages', `${SHARED_PAGE_ID}.json`), 'utf8').then(JSON.parse),
    fs.readFile(path.join(alphaRoot, 'appearance.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(betaRoot, 'appearance.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(alphaRoot, 'categories.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(betaRoot, 'categories.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(alphaRoot, 'workspaceState.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(betaRoot, 'workspaceState.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(alphaRoot, 'assets/resources/shared-vault.txt'), 'utf8'),
    fs.readFile(path.join(betaRoot, 'assets/resources/shared-vault.txt'), 'utf8')
  ]);
  assert.equal(alphaDiskPage.title, 'Alpha final title');
  assert.equal(betaDiskPage.title, 'Beta changed while Alpha was blocked');
  assert.equal(alphaDiskAppearance.accentColour, '#112233');
  assert.equal(betaDiskAppearance.accentColour, '#AABBCC');
  assert.deepEqual(alphaDiskCategories.navigation.enabledCategoryIds, ['category_alpha']);
  assert.deepEqual(betaDiskCategories.navigation.enabledCategoryIds, ['category_beta']);
  assert.equal(alphaDiskWorkspace.lastOpenedPageId, SHARED_PAGE_ID);
  assert.equal(betaDiskWorkspace.lastOpenedPageId, PEER_PAGE_ID);
  assert.equal(alphaDiskVaultAsset, 'alpha-vault-asset');
  assert.equal(betaDiskVaultAsset, 'beta-vault-asset');
  assert.ok(alphaDiskPage.maintenanceResources.some((item) => (
    item.location?.relativePath === 'slow.txt'
  )));
  assert.equal(betaDiskPage.maintenanceResources.some((item) => (
    item.location?.relativePath === 'slow.txt'
  )), false);

  const alphaVocabularyPath = path.join(alphaRoot, 'vocabulary.json');
  const alphaDescriptorsPath = path.join(alphaRoot, 'descriptors.json');
  const betaVocabularyPath = path.join(betaRoot, 'vocabulary.json');
  const betaDescriptorsPath = path.join(betaRoot, 'descriptors.json');
  const descriptorBytesBefore = {
    alphaVocabulary: await fs.readFile(alphaVocabularyPath, 'utf8'),
    alphaDescriptors: await fs.readFile(alphaDescriptorsPath, 'utf8'),
    betaVocabulary: await fs.readFile(betaVocabularyPath, 'utf8'),
    betaDescriptors: await fs.readFile(betaDescriptorsPath, 'utf8')
  };
  const alphaDescriptorClear = await requestJson(
    alphaServer,
    `/api/pages/${SHARED_PAGE_ID}`,
    jsonOptions('POST', {
      descriptors: { class_1: [], class_2: [], class_3: [] },
      ignoredDescriptors: emptyIgnoredDescriptors
    })
  );
  assert.equal(alphaDescriptorClear.response.status, 200, JSON.stringify(alphaDescriptorClear.body));
  const [alphaVocabularyMutation, betaUnrelatedPreferenceMutation] = await Promise.all([
    requestJson(
      alphaServer,
      '/api/vocabulary',
      jsonOptions('PUT', {
        version: 1,
        entries: [{
          id: 'vocab_alpha_only',
          display: 'Alpha Only',
          aliases: []
        }]
      })
    ),
    requestJson(
      betaServer,
      '/api/vault-preferences',
      jsonOptions('PATCH', { preserveSingleLineBreaks: true })
    )
  ]);
  assert.equal(
    alphaVocabularyMutation.response.status,
    200,
    JSON.stringify(alphaVocabularyMutation.body)
  );
  assert.equal(
    betaUnrelatedPreferenceMutation.response.status,
    200,
    JSON.stringify(betaUnrelatedPreferenceMutation.body)
  );
  assert.deepEqual(
    alphaVocabularyMutation.body.entries.map((entry) => entry.id),
    ['vocab_alpha_only']
  );
  assert.equal(betaUnrelatedPreferenceMutation.body.preserveSingleLineBreaks, true);
  assert.notEqual(await fs.readFile(alphaVocabularyPath, 'utf8'), descriptorBytesBefore.alphaVocabulary);
  assert.notEqual(await fs.readFile(alphaDescriptorsPath, 'utf8'), descriptorBytesBefore.alphaDescriptors);
  assert.equal(await fs.readFile(betaVocabularyPath, 'utf8'), descriptorBytesBefore.betaVocabulary);
  assert.equal(await fs.readFile(betaDescriptorsPath, 'utf8'), descriptorBytesBefore.betaDescriptors);
  const [alphaMetadataSnapshot, betaMetadataSnapshot] = await Promise.all([
    requestJson(alphaServer, '/api/descriptor-metadata/snapshot'),
    requestJson(betaServer, '/api/descriptor-metadata/snapshot')
  ]);
  assert.equal(
    alphaMetadataSnapshot.response.status,
    200,
    JSON.stringify(alphaMetadataSnapshot.body)
  );
  assert.equal(
    betaMetadataSnapshot.response.status,
    200,
    JSON.stringify(betaMetadataSnapshot.body)
  );
  assert.equal(
    alphaMetadataSnapshot.body.vocabulary.entries[0].id,
    'vocab_alpha_only'
  );
  const betaSharedVocabularyEntry = betaMetadataSnapshot.body.vocabulary.entries
    .find((entry) => entry.display === 'Shared Context Descriptor');
  assert.ok(betaSharedVocabularyEntry);
  assert.equal(
    betaMetadataSnapshot.body.descriptorRegistry.entries
      .find((entry) => entry.vocabularyEntryId === betaSharedVocabularyEntry.id)?.id,
    betaSharedDescriptor.entryId
  );

  const alphaPageIndexPath = path.join(alphaRoot, 'pageIndex.json');
  const alphaNavigationPath = path.join(alphaRoot, 'navigation.json');
  const betaPeerPagePath = path.join(betaRoot, 'pages', `${PEER_PAGE_ID}.json`);
  const betaPageIndexPath = path.join(betaRoot, 'pageIndex.json');
  const betaNavigationPath = path.join(betaRoot, 'navigation.json');
  const beforeAlphaDelete = {
    sharedPage: await fs.readFile(path.join(alphaRoot, 'pages', `${SHARED_PAGE_ID}.json`), 'utf8'),
    pageIndex: await fs.readFile(alphaPageIndexPath, 'utf8'),
    navigation: await fs.readFile(alphaNavigationPath, 'utf8')
  };
  const beforeBetaDuringAlphaDelete = {
    peerPage: await fs.readFile(betaPeerPagePath, 'utf8'),
    pageIndex: await fs.readFile(betaPageIndexPath, 'utf8'),
    navigation: await fs.readFile(betaNavigationPath, 'utf8')
  };
  const [alphaDelete, betaReadDuringAlphaDelete] = await Promise.all([
    requestJson(alphaServer, `/api/pages/${PEER_PAGE_ID}`, { method: 'DELETE' }),
    requestJson(betaServer, `/api/pages/${PEER_PAGE_ID}`)
  ]);
  assert.equal(alphaDelete.response.status, 200, JSON.stringify(alphaDelete.body));
  assert.equal(alphaDelete.body.deletedPageId, PEER_PAGE_ID);
  assert.equal(betaReadDuringAlphaDelete.response.status, 200);
  assert.equal(betaReadDuringAlphaDelete.body.id, PEER_PAGE_ID);
  await assert.rejects(
    fs.access(path.join(alphaRoot, 'pages', `${PEER_PAGE_ID}.json`)),
    { code: 'ENOENT' }
  );
  assert.equal(
    await fs.readFile(path.join(alphaRoot, 'pages', `${SHARED_PAGE_ID}.json`), 'utf8'),
    beforeAlphaDelete.sharedPage
  );
  assert.notEqual(await fs.readFile(alphaPageIndexPath, 'utf8'), beforeAlphaDelete.pageIndex);
  assert.notEqual(await fs.readFile(alphaNavigationPath, 'utf8'), beforeAlphaDelete.navigation);
  assert.equal(await fs.readFile(betaPeerPagePath, 'utf8'), beforeBetaDuringAlphaDelete.peerPage);
  assert.equal(await fs.readFile(betaPageIndexPath, 'utf8'), beforeBetaDuringAlphaDelete.pageIndex);
  assert.equal(await fs.readFile(betaNavigationPath, 'utf8'), beforeBetaDuringAlphaDelete.navigation);

  await Promise.all([alphaContext.close(), alphaContext.close()]);
  assert.equal(alphaContext.server, null);
  assert.equal(alphaServer.listening, false);

  const betaAfterAlphaClose = await expectJson(betaServer, '/api/project');
  assert.equal(betaAfterAlphaClose.projectId, 'vault_beta');

  const reboundAlphaRoot = path.join(temporaryRoot, 'Alpha Renamed');
  await fs.rename(alphaRoot, reboundAlphaRoot);
  await assert.rejects(fs.access(alphaRoot), { code: 'ENOENT' });
  const reboundAlphaResources = path.join(reboundAlphaRoot, 'external-resources');
  reboundAlphaContext = createVaultServerContext({
    appRoot: APP_ROOT,
    vaultId: 'vault_alpha',
    vaultRoot: reboundAlphaRoot,
    resourceResolver: async (location) => ({
      absolutePath: path.join(reboundAlphaResources, location.relativePath)
    }),
    displayProxyService: proxyService('alpha', alphaProxyPath, 'alpha-proxy'),
    desktopMutationToken: alphaToken
  });
  const reboundAlphaServer = await reboundAlphaContext.start({
    port: 0,
    host: '127.0.0.1'
  });
  assert.equal(reboundAlphaContext.vaultId, 'vault_alpha');
  assert.equal(reboundAlphaContext.vaultRoot, path.resolve(reboundAlphaRoot));
  const [reboundAlphaProject, reboundAlphaPage, reboundAlphaAppearance,
    reboundAlphaResource, betaDuringAlphaRebind] = await Promise.all([
    expectJson(reboundAlphaServer, '/api/project'),
    expectJson(reboundAlphaServer, `/api/pages/${SHARED_PAGE_ID}`),
    expectJson(reboundAlphaServer, '/api/appearance'),
    fetch(`${origin(reboundAlphaServer)}${sharedContentPath}`),
    expectJson(betaServer, '/api/project')
  ]);
  assert.equal(reboundAlphaProject.projectId, 'vault_alpha');
  assert.equal(reboundAlphaPage.title, 'Alpha final title');
  assert.equal(reboundAlphaAppearance.accentColour, '#112233');
  assert.equal(reboundAlphaResource.status, 200);
  assert.equal(await reboundAlphaResource.text(), 'alpha-resource');
  assert.equal(betaDuringAlphaRebind.projectId, 'vault_beta');
  const betaResourceAfterAlphaClose = await fetch(`${origin(betaServer)}${sharedContentPath}`);
  assert.equal(betaResourceAfterAlphaClose.status, 200);
  assert.equal(await betaResourceAfterAlphaClose.text(), 'beta-resource');

  const [alphaPreferenceDuringBetaClose] = await Promise.all([
    requestJson(
      reboundAlphaServer,
      '/api/vault-preferences',
      jsonOptions('PATCH', { preserveSingleLineBreaks: true })
    ),
    betaContext.close()
  ]);
  assert.equal(
    alphaPreferenceDuringBetaClose.response.status,
    200,
    JSON.stringify(alphaPreferenceDuringBetaClose.body)
  );
  assert.equal(alphaPreferenceDuringBetaClose.body.preserveSingleLineBreaks, true);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(reboundAlphaRoot, 'vault.json'), 'utf8'))
      .preserveSingleLineBreaks,
    true
  );
  assert.equal(betaContext.server, null);
  assert.equal(betaServer.listening, false);
  assert.equal((await expectJson(reboundAlphaServer, '/api/project')).projectId, 'vault_alpha');
  await reboundAlphaContext.close();
  assert.equal(reboundAlphaContext.server, null);
  assert.equal(reboundAlphaServer.listening, false);

  assert.ok(resolverCalls.alpha.some((entry) => entry.relativePath === 'same.txt'));
  assert.ok(resolverCalls.alpha.some((entry) => entry.relativePath === 'fail.txt'));
  assert.ok(resolverCalls.alpha.some((entry) => entry.relativePath === 'slow.txt'));
  assert.ok(resolverCalls.beta.some((entry) => entry.relativePath === 'same.txt'));
  assert.ok(resolverCalls.beta.some((entry) => entry.relativePath === 'fail.txt'));
  assert.ok(resolverCalls.alpha.some((entry) => (
    entry.type === 'folder' && entry.folderId === 'folder_shared'
  )));
  assert.ok(resolverCalls.beta.some((entry) => (
    entry.type === 'folder' && entry.folderId === 'folder_shared'
  )));
  assert.ok(resolverCalls.alpha.some((entry) => (
    entry.type === 'workspace' && entry.workspaceId === 'workspace_shared'
  )));
  assert.ok(resolverCalls.beta.some((entry) => (
    entry.type === 'workspace' && entry.workspaceId === 'workspace_shared'
  )));
  assert.ok(resolverCalls.alpha.some((entry) => (
    entry.type === 'vault' && entry.relativePath === 'assets/resources/shared-vault.txt'
  )));
  assert.ok(resolverCalls.beta.some((entry) => (
    entry.type === 'vault' && entry.relativePath === 'assets/resources/shared-vault.txt'
  )));
});

test('a late Vault A transaction failure rolls back only A while Vault B commits and stays healthy', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-context-rollback-'));
  const alphaRoot = path.join(temporaryRoot, 'Alpha');
  const betaRoot = path.join(temporaryRoot, 'Beta');
  await Promise.all([
    seedVault(alphaRoot, {
      vaultId: 'vault_rollback_alpha',
      displayName: 'Rollback Alpha',
      resourceContents: {
        'same.txt': 'alpha-resource',
        'fail.txt': 'alpha-failure-source',
        'slow.txt': 'alpha-slow-resource',
        'workspace.txt': 'alpha-workspace-resource'
      },
      categoryId: 'category_alpha',
      categoryLabel: 'Alpha Category',
      externalUrl: 'https://alpha.example.test/resource',
      vaultAssetContents: 'alpha-vault-asset'
    }),
    seedVault(betaRoot, {
      vaultId: 'vault_rollback_beta',
      displayName: 'Rollback Beta',
      resourceContents: {
        'same.txt': 'beta-resource',
        'fail.txt': 'beta-failure-source',
        'slow.txt': 'beta-slow-resource',
        'workspace.txt': 'beta-workspace-resource'
      },
      categoryId: 'category_beta',
      categoryLabel: 'Beta Category',
      externalUrl: 'https://beta.example.test/resource',
      vaultAssetContents: 'beta-vault-asset'
    })
  ]);

  const presetColour = '#A1B2C3';
  const replacementColour = '#778899';
  const alphaAppearancePath = path.join(alphaRoot, 'appearance.json');
  const betaAppearancePath = path.join(betaRoot, 'appearance.json');
  const alphaPagePath = path.join(alphaRoot, 'pages', `${SHARED_PAGE_ID}.json`);
  const alphaPageIndexPath = path.join(alphaRoot, 'pageIndex.json');
  const configuredAppearance = {
    blockAppearance: {
      colourful: true,
      colourfulBlock: {
        presets: [
          { id: 'preset_primary', colour: presetColour },
          { id: 'preset_other', colour: '#445566' }
        ],
        lastUsedColour: '#ABCDEF'
      },
      monochrome: {
        colour: '#6785A3',
        opacity: { status1: 0.1, status2: 0.4, status3: 0.8 },
        borderWidth: 2
      }
    }
  };
  await Promise.all([
    writeJson(alphaAppearancePath, configuredAppearance),
    writeJson(betaAppearancePath, configuredAppearance)
  ]);
  const alphaPageWithColour = JSON.parse(await fs.readFile(alphaPagePath, 'utf8'));
  alphaPageWithColour.objects = [{
    id: 'object_rollback',
    type: 'image',
    x: 0,
    y: 0,
    width: 200,
    height: 100
  }];
  alphaPageWithColour.blocks = [{
    id: 'block_rollback',
    objectId: 'object_rollback',
    x: 10,
    y: 10,
    width: 80,
    height: 40,
    rotation: 0,
    links: [],
    colour: presetColour
  }];
  await writeJson(alphaPagePath, alphaPageWithColour);

  const alphaContext = createVaultServerContext({
    appRoot: APP_ROOT,
    vaultId: 'vault_rollback_alpha',
    vaultRoot: alphaRoot
  });
  const betaContext = createVaultServerContext({
    appRoot: APP_ROOT,
    vaultId: 'vault_rollback_beta',
    vaultRoot: betaRoot
  });
  const originalRename = fs.rename;
  let renameHookInstalled = false;
  t.after(async () => {
    if (renameHookInstalled) fs.rename = originalRename;
    await Promise.allSettled([alphaContext.close(), betaContext.close()]);
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });
  const [alphaServer, betaServer] = await Promise.all([
    alphaContext.start({ port: 0, host: '127.0.0.1' }),
    betaContext.start({ port: 0, host: '127.0.0.1' })
  ]);

  const beforeAlpha = {
    appearance: await fs.readFile(alphaAppearancePath, 'utf8'),
    page: await fs.readFile(alphaPagePath, 'utf8'),
    pageIndex: await fs.readFile(alphaPageIndexPath, 'utf8')
  };
  const betaDefaults = await expectJson(betaServer, '/api/appearance');
  const alphaLateRenameEntered = deferred();
  const releaseAlphaLateRename = deferred();
  let deniedAlphaPageIndex = false;
  fs.rename = async (source, destination) => {
    if (!deniedAlphaPageIndex
      && path.resolve(destination) === path.resolve(alphaPageIndexPath)) {
      deniedAlphaPageIndex = true;
      alphaLateRenameEntered.resolve();
      await releaseAlphaLateRename.promise;
      throw permissionDenied(alphaPageIndexPath, 'rename');
    }
    return originalRename.call(fs, source, destination);
  };
  renameHookInstalled = true;

  let alphaFailureRequest = null;
  let alphaFailureResult = null;
  try {
    alphaFailureRequest = requestJson(
      alphaServer,
      '/api/appearance/block-colour-presets/preset_primary',
      jsonOptions('PATCH', {
        expectedColour: presetColour,
        colour: replacementColour,
        globalApply: true
      })
    );
    await within(
      alphaLateRenameEntered.promise,
      ISOLATION_TIMEOUT_MS,
      'Vault A did not reach the injected late page-index rename failure.'
    );

    const [betaCommit, betaReadDuringAlphaFailure] = await within(
      Promise.all([
        requestJson(
          betaServer,
          '/api/appearance',
          jsonOptions('PUT', { ...betaDefaults, accentColour: '#223344' })
        ),
        requestJson(betaServer, '/api/project')
      ]),
      ISOLATION_TIMEOUT_MS,
      'Vault B was blocked by Vault A\'s pending transaction failure.'
    );
    assert.equal(betaCommit.response.status, 200, JSON.stringify(betaCommit.body));
    assert.equal(betaCommit.body.accentColour, '#223344');
    assert.equal(betaReadDuringAlphaFailure.response.status, 200);
    assert.equal(betaReadDuringAlphaFailure.body.projectId, 'vault_rollback_beta');

    releaseAlphaLateRename.resolve();
    alphaFailureResult = await alphaFailureRequest;
  } finally {
    releaseAlphaLateRename.resolve();
    if (alphaFailureRequest && !alphaFailureResult) {
      await alphaFailureRequest.catch(() => {});
    }
    fs.rename = originalRename;
    renameHookInstalled = false;
  }

  assert.equal(deniedAlphaPageIndex, true);
  assert.equal(alphaFailureResult.response.status, 500);
  assert.deepEqual({
    appearance: await fs.readFile(alphaAppearancePath, 'utf8'),
    page: await fs.readFile(alphaPagePath, 'utf8'),
    pageIndex: await fs.readFile(alphaPageIndexPath, 'utf8')
  }, beforeAlpha);

  const [alphaAfterRollback, betaAfterRollback, betaPageAfterRollback] = await Promise.all([
    expectJson(alphaServer, '/api/appearance'),
    expectJson(betaServer, '/api/appearance'),
    expectJson(betaServer, `/api/pages/${SHARED_PAGE_ID}`)
  ]);
  assert.equal(
    alphaAfterRollback.blockAppearance.colourfulBlock.presets[0].colour,
    presetColour
  );
  assert.equal(betaAfterRollback.accentColour, '#223344');
  assert.equal(betaPageAfterRollback.title, 'Rollback Beta shared');
  assert.equal(
    JSON.parse(await fs.readFile(betaAppearancePath, 'utf8')).accentColour,
    '#223344'
  );

  await alphaContext.close();
  const betaAfterAlphaClose = await expectJson(betaServer, '/api/project');
  assert.equal(betaAfterAlphaClose.projectId, 'vault_rollback_beta');
  await betaContext.close();
});
