const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createVaultServerContext } = require('../server/appServer');

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function jsonRequest(origin, pathname, options = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  return { response, body: await response.json() };
}

function closeServer(server) {
  return server.vaultServerContext.close();
}

async function startIsolatedServer(vaultRoot) {
  const appRoot = path.resolve(__dirname, '..');
  const context = createVaultServerContext({
    appRoot,
    vaultId: path.basename(vaultRoot),
    vaultRoot
  });
  const server = await context.start({ host: '127.0.0.1', port: 0 });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function createHnVault() {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-cne-text-http-'));
  await writeJson(path.join(vaultRoot, 'vault.json'), {
    vaultId: 'vault_cne_text',
    displayName: 'HN Text',
    schemaVersion: 1,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    defaultPageType: 'cne-text',
    lastMarkdownMode: 'live-preview'
  });
  await writeJson(path.join(vaultRoot, 'pageIndex.json'), { pages: [] });
  await writeJson(path.join(vaultRoot, 'navigation.json'), {
    version: 3,
    folders: [],
    items: [],
    pageStates: {},
    bindings: []
  });
  return vaultRoot;
}

function sourceEnvelope(revision, label) {
  return {
    schemaVersion: 3,
    revision,
    source: `Paragraph ${label}\n\n## Heading ${label}`,
    anchors: {}
  };
}

function pageEnvelope(id, cneText) {
  return {
    id,
    type: 'cne-text',
    title: id,
    categories: [],
    descriptors: {},
    ignoredDescriptors: {},
    ignoredManualEntryIds: {},
    objects: [],
    maintenanceResources: [],
    externalLinks: [],
    blocks: [],
    highlightGroups: [],
    backlinks: [],
    cneText
  };
}

test('legacy CNE storage migrates only on an explicit source save and rejects lossy migration', async (t) => {
  const vaultRoot = await createHnVault();
  const legacyId = 'legacy_supported';
  const unsupportedId = 'legacy_unsupported';
  const supportedLegacy = {
    schemaVersion: 1,
    revision: 4,
    document: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: { id: 'legacy-supported-paragraph' },
        content: [{ type: 'text', text: 'Legacy visible text' }]
      }]
    }
  };
  const unsupportedLegacy = {
    schemaVersion: 2,
    revision: 2,
    document: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: { id: 'legacy-unsupported-paragraph' },
        content: [{ type: 'text', text: 'Linked', marks: [{ type: 'link' }] }]
      }]
    }
  };
  const pages = [
    pageEnvelope(legacyId, supportedLegacy),
    pageEnvelope(unsupportedId, unsupportedLegacy)
  ];
  await writeJson(path.join(vaultRoot, 'pageIndex.json'), {
    pages: pages.map(({ id, type, title }) => ({
      id,
      type,
      title,
      path: `pages/${id}.json`
    }))
  });
  await writeJson(path.join(vaultRoot, 'navigation.json'), {
    version: 3,
    folders: [],
    items: pages.map(({ id }) => id),
    pageStates: {},
    bindings: []
  });
  await Promise.all(pages.map((page) => writeJson(
    path.join(vaultRoot, 'pages', `${page.id}.json`),
    page
  )));

  const running = await startIsolatedServer(vaultRoot);
  t.after(() => closeServer(running.server));

  const loaded = await jsonRequest(running.origin, `/api/pages/${legacyId}`);
  assert.equal(loaded.response.status, 200);
  assert.deepEqual(loaded.body.cneText, supportedLegacy);
  const legacyPath = path.join(vaultRoot, 'pages', `${legacyId}.json`);
  assert.deepEqual(JSON.parse(await fs.readFile(legacyPath, 'utf8')).cneText, supportedLegacy);

  const metadataOnly = await jsonRequest(running.origin, `/api/pages/${legacyId}`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Renamed legacy Page' })
  });
  assert.equal(metadataOnly.response.status, 200);
  assert.deepEqual(metadataOnly.body.page.cneText, supportedLegacy);
  assert.deepEqual(JSON.parse(await fs.readFile(legacyPath, 'utf8')).cneText, supportedLegacy);

  const explicitSource = {
    schemaVersion: 3,
    revision: 4,
    source: 'Legacy visible text — edited 中文',
    anchors: {}
  };
  const migratedSave = await jsonRequest(running.origin, `/api/pages/${legacyId}`, {
    method: 'POST',
    body: JSON.stringify({ cneText: explicitSource, baseRevision: 4 })
  });
  assert.equal(migratedSave.response.status, 200);
  assert.deepEqual(migratedSave.body.page.cneText, { ...explicitSource, revision: 5 });
  assert.deepEqual(
    JSON.parse(await fs.readFile(legacyPath, 'utf8')).cneText,
    { ...explicitSource, revision: 5 }
  );

  const unsupportedPath = path.join(vaultRoot, 'pages', `${unsupportedId}.json`);
  const unsupportedLoaded = await jsonRequest(running.origin, `/api/pages/${unsupportedId}`);
  assert.equal(unsupportedLoaded.response.status, 200);
  assert.deepEqual(unsupportedLoaded.body.cneText, unsupportedLegacy);
  const rejected = await jsonRequest(running.origin, `/api/pages/${unsupportedId}`, {
    method: 'POST',
    body: JSON.stringify({
      cneText: sourceEnvelope(2, 'Must not replace unsupported legacy content'),
      baseRevision: 2
    })
  });
  assert.equal(rejected.response.status, 422);
  assert.equal(rejected.body.readOnly, true);
  assert.ok(Array.isArray(rejected.body.errors));
  assert.deepEqual(
    JSON.parse(await fs.readFile(unsupportedPath, 'utf8')).cneText,
    unsupportedLegacy
  );
});

test('HN Text saves are schema-valid, revisioned, transactional, and restart-safe', async (t) => {
  const vaultRoot = await createHnVault();
  let running = await startIsolatedServer(vaultRoot);
  t.after(async () => {
    if (running?.server?.listening) await closeServer(running.server);
  });

  const created = await jsonRequest(running.origin, '/api/pages', {
    method: 'POST',
    body: JSON.stringify({})
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.page.type, 'cne-text');
  assert.deepEqual(created.body.page.cneText, {
    schemaVersion: 3,
    revision: 0,
    source: '',
    anchors: {}
  });
  const pageId = created.body.page.id;
  const pagePath = path.join(vaultRoot, 'pages', `${pageId}.json`);
  const indexPath = path.join(vaultRoot, 'pageIndex.json');

  for (const baseRevision of [undefined, null, -1, 0.5, '0', Number.MAX_SAFE_INTEGER + 1]) {
    const requestBody = { cneText: sourceEnvelope(0, 'missing-base') };
    if (baseRevision !== undefined) requestBody.baseRevision = baseRevision;
    const rejected = await jsonRequest(running.origin, `/api/pages/${pageId}`, {
      method: 'POST',
      body: JSON.stringify(requestBody)
    });
    assert.equal(rejected.response.status, 400);
  }

  const firstEnvelope = sourceEnvelope(0, 'first');
  const firstSave = await jsonRequest(running.origin, `/api/pages/${pageId}`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Revisioned HN Page',
      cneText: firstEnvelope,
      baseRevision: 0
    })
  });
  assert.equal(firstSave.response.status, 200);
  assert.equal(firstSave.body.page.title, 'Revisioned HN Page');
  assert.deepEqual(firstSave.body.page.cneText, { ...firstEnvelope, revision: 1 });
  const firstIndex = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  const firstIndexEntry = firstIndex.pages.find(({ id }) => id === pageId);
  assert.equal(firstIndexEntry.title, 'Revisioned HN Page');
  assert.equal(firstIndexEntry.type, 'cne-text');
  assert.equal(Object.hasOwn(firstIndexEntry, 'cneText'), false);

  const mirroredCandidates = ['pane-a', 'pane-b'].map((label) => jsonRequest(
    running.origin,
    `/api/pages/${pageId}`,
    {
      method: 'POST',
      body: JSON.stringify({
        cneText: sourceEnvelope(1, label),
        baseRevision: 1
      })
    }
  ));
  const mirroredResults = await Promise.all(mirroredCandidates);
  assert.deepEqual(
    mirroredResults.map(({ response }) => response.status).sort((a, b) => a - b),
    [200, 409]
  );
  const staleConcurrent = mirroredResults.find(({ response }) => response.status === 409);
  assert.equal(staleConcurrent.body.code, 'STALE_CNE_REVISION');
  assert.equal(staleConcurrent.body.baseRevision, 1);
  assert.equal(staleConcurrent.body.currentRevision, 2);

  const afterConcurrent = await jsonRequest(running.origin, `/api/pages/${pageId}`);
  assert.equal(afterConcurrent.response.status, 200);
  assert.equal(afterConcurrent.body.cneText.revision, 2);
  assert.ok(['Paragraph pane-a', 'Paragraph pane-b'].some((label) => (
    afterConcurrent.body.cneText.source.startsWith(label)
  )));

  const staleWithMetadata = await jsonRequest(running.origin, `/api/pages/${pageId}`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Must Not Win',
      cneText: sourceEnvelope(1, 'stale'),
      baseRevision: 1
    })
  });
  assert.equal(staleWithMetadata.response.status, 409);
  assert.equal(staleWithMetadata.body.code, 'STALE_CNE_REVISION');
  const afterStale = await jsonRequest(running.origin, `/api/pages/${pageId}`);
  assert.equal(afterStale.body.title, 'Revisioned HN Page');
  assert.equal(afterStale.body.cneText.revision, 2);

  const transientEnvelopes = [
    ['editorState', { doc: 'runtime-only' }],
    ['dom', '<p>runtime-only</p>'],
    ['html', '<p>runtime-only</p>'],
    ['selection', { anchor: 1, head: 1 }],
    ['history', { undo: [] }],
    ['decorations', []]
  ].map(([field, value]) => ({
    ...sourceEnvelope(2, `transient-${field}`),
    [field]: value
  }));
  const invalidEnvelopes = [
    ...transientEnvelopes,
    {
      ...sourceEnvelope(2, 'document-owner'),
      document: { type: 'doc', content: [] }
    },
    {
      ...sourceEnvelope(2, 'non-string-source'),
      source: { text: 'not canonical source' }
    },
    {
      ...sourceEnvelope(2, 'premature-anchor'),
      anchors: { future_anchor: { offset: 0 } }
    },
    {
      ...sourceEnvelope(2, 'future-schema'),
      schemaVersion: 99
    }
  ];
  for (const cneText of invalidEnvelopes) {
    const rejected = await jsonRequest(running.origin, `/api/pages/${pageId}`, {
      method: 'POST',
      body: JSON.stringify({ cneText, baseRevision: 2 })
    });
    assert.equal(rejected.response.status, 400);
  }

  const mismatchedEnvelopeRevision = await jsonRequest(
    running.origin,
    `/api/pages/${pageId}`,
    {
      method: 'POST',
      body: JSON.stringify({
        cneText: sourceEnvelope(1, 'wrong-envelope-revision'),
        baseRevision: 2
      })
    }
  );
  assert.equal(mismatchedEnvelopeRevision.response.status, 400);

  const fullFrameSave = await jsonRequest(running.origin, `/api/pages/${pageId}`, {
    method: 'POST',
    body: JSON.stringify({
      textFrame: { centerWorldX: 137, preferredWidth: 1000 }
    })
  });
  assert.equal(fullFrameSave.response.status, 200);
  assert.deepEqual(fullFrameSave.body.page.textFrame, {
    centerWorldX: 137,
    preferredWidth: 1000
  });

  const widthOnlyFrameSave = await jsonRequest(running.origin, `/api/pages/${pageId}`, {
    method: 'POST',
    body: JSON.stringify({
      textFrame: { preferredWidth: 900 }
    })
  });
  assert.equal(widthOnlyFrameSave.response.status, 200);
  assert.deepEqual(widthOnlyFrameSave.body.page.textFrame, {
    centerWorldX: 137,
    preferredWidth: 900
  });

  for (const crossTypeChanges of [
    { markdownBody: '# Wrong owner' },
    { objects: [{ id: 'object_wrong_owner' }] },
    { blocks: [{ id: 'block_wrong_owner' }] }
  ]) {
    const rejected = await jsonRequest(running.origin, `/api/pages/${pageId}`, {
      method: 'POST',
      body: JSON.stringify({
        ...crossTypeChanges,
        cneText: sourceEnvelope(2, 'cross-type'),
        baseRevision: 2
      })
    });
    assert.equal(rejected.response.status, 400);
  }
  const afterInvalid = await jsonRequest(running.origin, `/api/pages/${pageId}`);
  assert.equal(afterInvalid.body.cneText.revision, 2);
  assert.equal(afterInvalid.body.title, 'Revisioned HN Page');

  const finalEnvelope = sourceEnvelope(2, 'final');
  const finalSave = await jsonRequest(running.origin, `/api/pages/${pageId}`, {
    method: 'POST',
    body: JSON.stringify({ cneText: finalEnvelope, baseRevision: 2 })
  });
  assert.equal(finalSave.response.status, 200);
  assert.deepEqual(finalSave.body.page.cneText, { ...finalEnvelope, revision: 3 });

  const beforeFailedAtomicSave = await fs.readFile(pagePath, 'utf8');
  const beforeFailedAtomicIndex = await fs.readFile(indexPath, 'utf8');
  const vaultMode = (await fs.stat(vaultRoot)).mode & 0o777;
  await fs.chmod(vaultRoot, 0o555);
  let failedAtomicSave;
  try {
    failedAtomicSave = await jsonRequest(running.origin, `/api/pages/${pageId}`, {
      method: 'POST',
      body: JSON.stringify({
        cneText: sourceEnvelope(3, 'must-roll-back'),
        baseRevision: 3
      })
    });
  } finally {
    await fs.chmod(vaultRoot, vaultMode);
  }
  assert.equal(failedAtomicSave.response.status, 500);
  assert.equal(await fs.readFile(pagePath, 'utf8'), beforeFailedAtomicSave);
  assert.equal(await fs.readFile(indexPath, 'utf8'), beforeFailedAtomicIndex);

  await closeServer(running.server);
  running = await startIsolatedServer(vaultRoot);
  const afterRestart = await jsonRequest(running.origin, `/api/pages/${pageId}`);
  assert.equal(afterRestart.response.status, 200);
  assert.equal(afterRestart.body.type, 'cne-text');
  assert.equal(afterRestart.body.title, 'Revisioned HN Page');
  assert.deepEqual(afterRestart.body.cneText, { ...finalEnvelope, revision: 3 });
  assert.equal(Object.hasOwn(afterRestart.body.cneText, 'selection'), false);
  assert.equal(Object.hasOwn(afterRestart.body.cneText, 'editorState'), false);
  assert.equal(Object.hasOwn(afterRestart.body.cneText, 'dom'), false);
  assert.equal(Object.hasOwn(afterRestart.body.cneText, 'history'), false);
  assert.equal(Object.hasOwn(afterRestart.body.cneText, 'decorations'), false);
  assert.equal(Object.hasOwn(afterRestart.body.cneText, 'html'), false);

  const restartIndex = await jsonRequest(running.origin, '/api/page-index');
  const restartEntry = restartIndex.body.pages.find(({ id }) => id === pageId);
  assert.equal(restartEntry.type, 'cne-text');
  assert.equal(restartEntry.title, 'Revisioned HN Page');
  assert.equal(Object.hasOwn(restartEntry, 'cneText'), false);
});
