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

test('HN Text and unknown Page identities survive generic server normalization and restart', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-page-types-http-'));
  const legacyId = 'page_legacy';
  const unknownId = 'page_future';
  const invalidHnId = 'page_invalid_cne';
  await writeJson(path.join(vaultRoot, 'vault.json'), {
    vaultId: 'vault_page_types',
    displayName: 'Page Types',
    schemaVersion: 1,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    defaultPageType: 'cne-text',
    lastMarkdownMode: 'live-preview'
  });
  await writeJson(path.join(vaultRoot, 'pageIndex.json'), {
    pages: [
      { id: legacyId, title: 'Legacy', path: `pages/${legacyId}.json` },
      {
        id: unknownId,
        type: 'future-page-type',
        title: 'Future',
        path: `pages/${unknownId}.json`
      },
      {
        id: invalidHnId,
        type: 'cne-text',
        title: 'Future HN',
        path: `pages/${invalidHnId}.json`
      }
    ]
  });
  await writeJson(path.join(vaultRoot, 'navigation.json'), {
    version: 3,
    folders: [],
    items: [legacyId, unknownId, invalidHnId],
    pageStates: {},
    bindings: []
  });
  await writeJson(path.join(vaultRoot, `pages/${legacyId}.json`), {
    id: legacyId,
    title: 'Legacy',
    objects: [],
    maintenanceResources: [],
    externalLinks: [],
    blocks: [],
    highlightGroups: [],
    backlinks: []
  });
  await writeJson(path.join(vaultRoot, `pages/${unknownId}.json`), {
    id: unknownId,
    type: 'future-page-type',
    title: 'Future',
    futureDocument: { untouched: true },
    objects: [],
    maintenanceResources: [],
    externalLinks: [],
    blocks: [],
    highlightGroups: [],
    backlinks: []
  });
  const futureHnText = {
    schemaVersion: 1,
    revision: 0,
    document: { type: 'future-doc', content: [{ type: 'keep' }] }
  };
  await writeJson(path.join(vaultRoot, `pages/${invalidHnId}.json`), {
    id: invalidHnId,
    type: 'cne-text',
    title: 'Future HN',
    cneText: futureHnText,
    objects: [],
    maintenanceResources: [],
    externalLinks: [],
    blocks: [],
    highlightGroups: [],
    backlinks: []
  });

  let running = await startIsolatedServer(vaultRoot);
  t.after(async () => {
    if (running?.server?.listening) await closeServer(running.server);
  });

  const legacy = await jsonRequest(running.origin, `/api/pages/${legacyId}`);
  assert.equal(legacy.response.status, 200);
  assert.equal(legacy.body.type, 'canvas');

  const unknown = await jsonRequest(running.origin, `/api/pages/${unknownId}`);
  assert.equal(unknown.response.status, 415);
  assert.equal(unknown.body.type, 'future-page-type');
  const storedUnknown = JSON.parse(await fs.readFile(
    path.join(vaultRoot, `pages/${unknownId}.json`),
    'utf8'
  ));
  assert.equal(storedUnknown.type, 'future-page-type');
  assert.deepEqual(storedUnknown.futureDocument, { untouched: true });
  const unknownMutation = await jsonRequest(running.origin, `/api/pages/${unknownId}`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Must not mutate' })
  });
  assert.equal(unknownMutation.response.status, 415);
  const unknownSpecializedMutation = await jsonRequest(
    running.origin,
    `/api/pages/${unknownId}/external-links`,
    { method: 'POST', body: JSON.stringify({}) }
  );
  assert.equal(unknownSpecializedMutation.response.status, 415);

  const invalidHn = await jsonRequest(running.origin, `/api/pages/${invalidHnId}`);
  assert.equal(invalidHn.response.status, 422);
  assert.equal(invalidHn.body.type, 'cne-text');
  assert.deepEqual(JSON.parse(await fs.readFile(
    path.join(vaultRoot, `pages/${invalidHnId}.json`),
    'utf8'
  )).cneText, futureHnText);

  const preferences = await jsonRequest(running.origin, '/api/vault-preferences');
  assert.deepEqual(preferences.body, {
    defaultPageType: 'cne-text',
    lastMarkdownMode: 'live-preview',
    cneTextMode: 'edit',
    preserveSingleLineBreaks: false
  });
  const invalidPreference = await jsonRequest(running.origin, '/api/vault-preferences', {
    method: 'PATCH',
    body: JSON.stringify({ defaultPageType: 'future-page-type' })
  });
  assert.equal(invalidPreference.response.status, 400);
  for (const invalidType of [null, 42, {}, '', '   ']) {
    const invalidExplicitPreference = await jsonRequest(running.origin, '/api/vault-preferences', {
      method: 'PATCH',
      body: JSON.stringify({ defaultPageType: invalidType })
    });
    assert.equal(invalidExplicitPreference.response.status, 400);
  }
  const lineBreakPreference = await jsonRequest(running.origin, '/api/vault-preferences', {
    method: 'PATCH',
    body: JSON.stringify({ preserveSingleLineBreaks: true })
  });
  assert.equal(lineBreakPreference.response.status, 200);
  assert.deepEqual(lineBreakPreference.body, {
    defaultPageType: 'cne-text',
    lastMarkdownMode: 'live-preview',
    cneTextMode: 'edit',
    preserveSingleLineBreaks: true
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
  assert.deepEqual(created.body.page.textFrame, { centerWorldX: 0, preferredWidth: 760 });
  assert.equal(created.body.pageEntry.type, 'cne-text');
  assert.equal(Object.hasOwn(created.body.pageEntry, 'cneText'), false);
  const hnPageId = created.body.page.id;

  const positionedFrame = await jsonRequest(running.origin, `/api/pages/${hnPageId}`, {
    method: 'POST',
    body: JSON.stringify({ textFrame: { centerWorldX: 240, preferredWidth: 900 } })
  });
  assert.equal(positionedFrame.response.status, 200);
  assert.deepEqual(positionedFrame.body.page.textFrame, {
    centerWorldX: 240,
    preferredWidth: 900
  });
  const widthOnlyFrame = await jsonRequest(running.origin, `/api/pages/${hnPageId}`, {
    method: 'POST',
    body: JSON.stringify({ textFrame: { preferredWidth: 1000 } })
  });
  assert.equal(widthOnlyFrame.response.status, 200);
  assert.deepEqual(widthOnlyFrame.body.page.textFrame, {
    centerWorldX: 240,
    preferredWidth: 1000
  });

  const saved = await jsonRequest(running.origin, `/api/pages/${hnPageId}`, {
    method: 'POST',
    body: JSON.stringify({
      cneText: created.body.page.cneText,
      baseRevision: 0
    })
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.page.type, 'cne-text');
  assert.deepEqual(saved.body.page.cneText, {
    ...created.body.page.cneText,
    revision: 1
  });
  const invalidRevision = await jsonRequest(running.origin, `/api/pages/${hnPageId}`, {
    method: 'POST',
    body: JSON.stringify({
      cneText: created.body.page.cneText,
      baseRevision: 1
    })
  });
  assert.equal(invalidRevision.response.status, 400);

  const markdownField = await jsonRequest(running.origin, `/api/pages/${hnPageId}`, {
    method: 'POST',
    body: JSON.stringify({ markdownBody: '# Wrong owner' })
  });
  assert.equal(markdownField.response.status, 400);
  const canvasField = await jsonRequest(running.origin, `/api/pages/${hnPageId}`, {
    method: 'POST',
    body: JSON.stringify({ objects: [{ id: 'object_wrong' }] })
  });
  assert.equal(canvasField.response.status, 400);

  const eligibility = await jsonRequest(
    running.origin,
    `/api/pages/${hnPageId}/type-eligibility`
  );
  assert.equal(eligibility.response.status, 200);
  assert.equal(eligibility.body.targets.canvas.allowed, true);
  assert.equal(eligibility.body.targets.markdown.allowed, true);
  assert.equal(eligibility.body.targets['cne-text'].allowed, true);
  const conversion = await jsonRequest(running.origin, `/api/pages/${hnPageId}/type`, {
    method: 'POST',
    body: JSON.stringify({ type: 'canvas' })
  });
  assert.equal(conversion.response.status, 200);
  assert.equal(conversion.body.type, 'canvas');
  assert.equal(Object.hasOwn(conversion.body, 'cneText'), false);
  assert.equal(Object.hasOwn(conversion.body, 'markdownBody'), false);
  assert.equal(Object.hasOwn(conversion.body, 'textFrame'), false);
  const invalidConversion = await jsonRequest(running.origin, `/api/pages/${hnPageId}/type`, {
    method: 'POST',
    body: JSON.stringify({ type: null })
  });
  assert.equal(invalidConversion.response.status, 400);

  const rawIndexPath = path.join(vaultRoot, 'pageIndex.json');
  const contaminatedIndex = JSON.parse(await fs.readFile(rawIndexPath, 'utf8'));
  const contaminatedHnEntry = contaminatedIndex.pages.find(({ id }) => id === hnPageId);
  contaminatedHnEntry.cneText = created.body.page.cneText;
  contaminatedHnEntry.markdownBody = '# Body must not enter the index';
  await writeJson(rawIndexPath, contaminatedIndex);

  const externalLinkMutation = await jsonRequest(
    running.origin,
    `/api/pages/${hnPageId}/external-links`,
    {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'Canonical index check',
        targetKind: 'url',
        url: 'https://example.com/'
      })
    }
  );
  assert.equal(externalLinkMutation.response.status, 201);
  const settledRawIndex = JSON.parse(await fs.readFile(rawIndexPath, 'utf8'));
  const settledHnEntry = settledRawIndex.pages.find(({ id }) => id === hnPageId);
  assert.equal(Object.hasOwn(settledHnEntry, 'cneText'), false);
  assert.equal(Object.hasOwn(settledHnEntry, 'markdownBody'), false);

  const beforeRestartIndex = await jsonRequest(running.origin, '/api/page-index');
  const hnIndexEntry = beforeRestartIndex.body.pages.find(({ id }) => id === hnPageId);
  assert.equal(hnIndexEntry.type, 'canvas');
  assert.equal(Object.hasOwn(hnIndexEntry, 'cneText'), false);
  assert.equal(Object.hasOwn(hnIndexEntry, 'markdownBody'), false);
  assert.equal(
    beforeRestartIndex.body.pages.find(({ id }) => id === unknownId).type,
    'future-page-type'
  );

  await closeServer(running.server);
  running = await startIsolatedServer(vaultRoot);
  const afterRestart = await jsonRequest(running.origin, `/api/pages/${hnPageId}`);
  assert.equal(afterRestart.response.status, 200);
  assert.equal(afterRestart.body.type, 'canvas');
  assert.equal(Object.hasOwn(afterRestart.body, 'cneText'), false);
  assert.equal(Object.hasOwn(afterRestart.body, 'markdownBody'), false);
  assert.equal(Object.hasOwn(afterRestart.body, 'textFrame'), false);
  const afterRestartIndex = await jsonRequest(running.origin, '/api/page-index');
  assert.equal(
    afterRestartIndex.body.pages.find(({ id }) => id === hnPageId).type,
    'canvas'
  );
  assert.equal(Object.hasOwn(
    afterRestartIndex.body.pages.find(({ id }) => id === hnPageId),
    'cneText'
  ), false);
  assert.equal(
    afterRestartIndex.body.pages.find(({ id }) => id === unknownId).type,
    'future-page-type'
  );
  const afterRestartPreferences = await jsonRequest(running.origin, '/api/vault-preferences');
  assert.deepEqual(afterRestartPreferences.body, {
    defaultPageType: 'cne-text',
    lastMarkdownMode: 'live-preview',
    cneTextMode: 'edit',
    preserveSingleLineBreaks: true
  });
});
