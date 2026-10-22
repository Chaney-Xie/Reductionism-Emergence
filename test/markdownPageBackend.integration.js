const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

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
  const body = await response.json();
  return { response, body };
}

test('new Vault metadata carries Vault-scoped structured-text defaults', () => {
  const { vaultMetadata } = require('../server/vaultContext');
  const metadata = vaultMetadata({
    vaultId: 'vault_defaults',
    displayName: 'Defaults',
    now: '2026-08-03T00:00:00.000Z'
  });
  assert.equal(metadata.defaultPageType, 'canvas');
  assert.equal(metadata.lastMarkdownMode, 'live-preview');
  assert.equal(metadata.cneTextMode, 'edit');
  assert.equal(metadata.preserveSingleLineBreaks, false);
});

test('Markdown Page preferences, creation, persistence and conversion are Vault canonical', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-markdown-page-http-'));
  const sourcePageId = 'page_source';
  await writeJson(path.join(vaultRoot, 'vault.json'), {
    vaultId: 'vault_markdown',
    displayName: 'Markdown Test',
    schemaVersion: 1,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z'
  });
  await writeJson(path.join(vaultRoot, 'pageIndex.json'), {
    pages: [{ id: sourcePageId, title: 'Source', path: 'pages/source.json' }]
  });
  await writeJson(path.join(vaultRoot, 'navigation.json'), {
    version: 2,
    folders: [],
    items: [sourcePageId],
    pageStates: {}
  });
  await writeJson(path.join(vaultRoot, 'pages/source.json'), {
    id: sourcePageId,
    title: 'Source',
    categories: [],
    descriptors: {},
    ignoredDescriptors: {},
    objects: [],
    maintenanceResources: [],
    externalLinks: [],
    blocks: [{
      id: 'block_source', objectId: 'object_missing', x: 0, y: 0,
      width: 10, height: 10, links: []
    }],
    highlightGroups: [],
    backlinks: []
  });

  process.env.VIEWER_ROOT = vaultRoot;
  process.env.VIEWER_APP_ROOT = path.resolve(__dirname, '..');
  const { startServer } = require('../server/appServer');
  const server = await startServer({ host: '127.0.0.1', port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const legacyPage = await jsonRequest(origin, `/api/pages/${sourcePageId}`);
  assert.equal(legacyPage.response.status, 200);
  assert.equal(legacyPage.body.type, 'canvas');
  const legacyIndex = await jsonRequest(origin, '/api/page-index');
  assert.equal(legacyIndex.body.pages[0].type, 'canvas');

  const initialPreferences = await jsonRequest(origin, '/api/vault-preferences');
  assert.deepEqual(initialPreferences.body, {
    defaultPageType: 'canvas',
    lastMarkdownMode: 'live-preview',
    cneTextMode: 'edit',
    preserveSingleLineBreaks: false
  });
  const invalidPreferences = await jsonRequest(origin, '/api/vault-preferences', {
    method: 'PATCH', body: JSON.stringify({ defaultPageType: 'future-unknown-type' })
  });
  assert.equal(invalidPreferences.response.status, 400);
  const invalidLineBreakPreference = await jsonRequest(origin, '/api/vault-preferences', {
    method: 'PATCH', body: JSON.stringify({ preserveSingleLineBreaks: 'true' })
  });
  assert.equal(invalidLineBreakPreference.response.status, 400);
  const invalidHnModePreference = await jsonRequest(origin, '/api/vault-preferences', {
    method: 'PATCH', body: JSON.stringify({ cneTextMode: 'future-mode' })
  });
  assert.equal(invalidHnModePreference.response.status, 400);

  const preferences = await jsonRequest(origin, '/api/vault-preferences', {
    method: 'PATCH',
    body: JSON.stringify({
      defaultPageType: 'markdown',
      lastMarkdownMode: 'source',
      cneTextMode: 'browser',
      preserveSingleLineBreaks: true
    })
  });
  assert.equal(preferences.response.status, 200);
  assert.deepEqual(preferences.body, {
    defaultPageType: 'markdown',
    lastMarkdownMode: 'source',
    cneTextMode: 'browser',
    preserveSingleLineBreaks: true
  });
  const storedMetadata = JSON.parse(await fs.readFile(path.join(vaultRoot, 'vault.json'), 'utf8'));
  assert.equal(storedMetadata.defaultPageType, 'markdown');
  assert.equal(storedMetadata.lastMarkdownMode, 'source');
  assert.equal(storedMetadata.cneTextMode, 'browser');
  assert.equal(storedMetadata.preserveSingleLineBreaks, true);

  const created = await jsonRequest(origin, '/api/pages', {
    method: 'POST', body: JSON.stringify({})
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.page.type, 'markdown');
  assert.equal(created.body.page.markdownBody, '');
  assert.deepEqual(created.body.page.textFrame, { centerWorldX: 0, preferredWidth: 760 });
  assert.equal(created.body.pageEntry.type, 'markdown');
  const markdownPageId = created.body.page.id;

  const savedMarkdown = await jsonRequest(origin, `/api/pages/${markdownPageId}`, {
    method: 'POST',
    body: JSON.stringify({
      markdownBody: '# Visible body',
      textFrame: { preferredWidth: 840 }
    })
  });
  assert.equal(savedMarkdown.response.status, 200);
  assert.equal(savedMarkdown.body.page.markdownBody, '# Visible body');
  assert.deepEqual(savedMarkdown.body.page.textFrame, { centerWorldX: 0, preferredWidth: 840 });

  await Promise.all([
    jsonRequest(origin, `/api/pages/${markdownPageId}`, {
      method: 'POST', body: JSON.stringify({ markdownBody: '# Concurrent body' })
    }),
    jsonRequest(origin, `/api/pages/${markdownPageId}`, {
      method: 'POST', body: JSON.stringify({ title: 'Concurrent title' })
    })
  ]);
  const concurrentlySaved = await jsonRequest(origin, `/api/pages/${markdownPageId}`);
  assert.equal(concurrentlySaved.body.title, 'Concurrent title');
  assert.equal(concurrentlySaved.body.markdownBody, '# Concurrent body');

  const [crossEndpointBody, crossEndpointLink] = await Promise.all([
    jsonRequest(origin, `/api/pages/${markdownPageId}`, {
      method: 'POST', body: JSON.stringify({ markdownBody: '# Cross-endpoint body' })
    }),
    jsonRequest(origin, `/api/pages/${markdownPageId}/external-links`, {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'Concurrent reference',
        targetKind: 'url',
        url: 'https://example.test/reference'
      })
    })
  ]);
  assert.equal(crossEndpointBody.response.status, 200);
  assert.equal(crossEndpointLink.response.status, 201);
  const crossEndpointSaved = await jsonRequest(origin, `/api/pages/${markdownPageId}`);
  assert.equal(crossEndpointSaved.body.markdownBody, '# Cross-endpoint body');
  assert.equal(
    crossEndpointSaved.body.externalLinks.some((item) => item.displayName === 'Concurrent reference'),
    true
  );

  const invalidFrame = await jsonRequest(origin, `/api/pages/${markdownPageId}`, {
    method: 'POST', body: JSON.stringify({ textFrame: { preferredWidth: 0 } })
  });
  assert.equal(invalidFrame.response.status, 400);

  const blockedEligibility = await jsonRequest(
    origin,
    `/api/pages/${markdownPageId}/type-eligibility`
  );
  assert.equal(blockedEligibility.body.targets.canvas.allowed, false);
  assert.match(blockedEligibility.body.targets.canvas.reasons.join(' '), /Markdown body/);
  const blockedConversion = await jsonRequest(origin, `/api/pages/${markdownPageId}/type`, {
    method: 'POST', body: JSON.stringify({ type: 'canvas' })
  });
  assert.equal(blockedConversion.response.status, 409);

  await jsonRequest(origin, `/api/pages/${markdownPageId}`, {
    method: 'POST', body: JSON.stringify({ markdownBody: '   \n\n' })
  });
  const converted = await jsonRequest(origin, `/api/pages/${markdownPageId}/type`, {
    method: 'POST', body: JSON.stringify({ type: 'canvas' })
  });
  assert.equal(converted.response.status, 200);
  assert.equal(converted.body.type, 'canvas');
  assert.equal(Object.hasOwn(converted.body, 'markdownBody'), false);
  assert.equal(Object.hasOwn(converted.body, 'textFrame'), false);
  const convertedIndex = await jsonRequest(origin, '/api/page-index');
  assert.equal(convertedIndex.body.pages.find((entry) => entry.id === markdownPageId).type, 'canvas');

  const blockedCanvasConversion = await jsonRequest(origin, `/api/pages/${sourcePageId}/type`, {
    method: 'POST', body: JSON.stringify({ type: 'markdown' })
  });
  assert.equal(blockedCanvasConversion.response.status, 409);
  assert.match(blockedCanvasConversion.body.reasons.join(' '), /Blocks/);

  const linkedNewPage = await jsonRequest(
    origin,
    `/api/pages/${sourcePageId}/blocks/block_source/new-page-link`,
    { method: 'POST', body: JSON.stringify({}) }
  );
  assert.equal(linkedNewPage.response.status, 201);
  assert.equal(linkedNewPage.body.page.type, 'markdown');
  assert.equal(linkedNewPage.body.pageEntry.type, 'markdown');
});
