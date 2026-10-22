const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  createLinkedResourceService,
  desktopMutationAuthorized,
  resourceContentHeaders,
  resourceContentIsFresh
} = require('../server/linkedResourceService');
const { resolveResourceLocation } = require('../desktop/vaultPaths');

test('linked content lookup requires a stable resource ID and streams trusted persisted location', async () => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-content-vault-'));
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-content-workspace-'));
  await fs.mkdir(path.join(vaultRoot, 'assets/images'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, 'assets/resources'), { recursive: true });
  const filePath = path.join(workspaceRoot, 'A.png');
  await fs.writeFile(filePath, 'first');
  const page = {
    objects: [{
      id: 'object_stable',
      type: 'image',
      mimeType: 'image/png',
      location: { type: 'workspace', workspaceId: 'workspace_lab', relativePath: 'A.png' }
    }],
    maintenanceResources: []
  };
  const service = createLinkedResourceService({
    fsImpl: fs,
    resolveLocation: (location) => resolveResourceLocation(vaultRoot, location, {
      workspaceDefinitions: {
        workspaces: { workspace_lab: { id: 'workspace_lab', label: 'Lab' } }
      },
      workspaceRoots: { workspace_lab: workspaceRoot }
    })
  });

  const first = await service.prepareContent(page, 'object_stable');
  assert.equal(first.absolutePath, await fs.realpath(filePath));
  assert.equal(first.mimeType, 'image/png');
  assert.match(first.etag, /^W\//);
  assert.deepEqual(resourceContentHeaders(first), {
    'Cache-Control': 'no-cache',
    ETag: first.etag,
    'Last-Modified': first.lastModified,
    'Content-Type': 'image/png'
  });
  assert.equal(resourceContentIsFresh({ 'if-none-match': first.etag }, first), true);
  assert.equal(resourceContentIsFresh({ 'if-none-match': 'different' }, first), false);
  await assert.rejects(service.prepareContent(page, '/tmp/A.png'), {
    code: 'RESOURCE_NOT_FOUND'
  });

  await fs.writeFile(filePath, 'second-version');
  const second = await service.prepareContent(page, 'object_stable');
  assert.notEqual(second.etag, first.etag);
  assert.equal(second.size, 14);
  assert.equal(resourceContentIsFresh({ 'if-none-match': first.etag }, second), false);
});

test('linked content reports missing originals without removing their resource record', async () => {
  const page = {
    objects: [],
    maintenanceResources: [{
      id: 'resource_missing',
      location: { type: 'workspace', workspaceId: 'workspace_lab', relativePath: 'missing.sdf' }
    }]
  };
  const service = createLinkedResourceService({
    fsImpl: fs,
    resolveLocation: async () => {
      const error = new Error('File not found.');
      error.code = 'NOT_FOUND';
      throw error;
    }
  });
  await assert.rejects(service.prepareContent(page, 'resource_missing'), { code: 'NOT_FOUND' });
  assert.equal(page.maintenanceResources[0].id, 'resource_missing');
});

test('linked-original page mutation requires the private desktop token', () => {
  const token = 'desktop-only-token-123456';
  assert.equal(desktopMutationAuthorized(token, token), true);
  assert.equal(desktopMutationAuthorized(token, 'renderer-guess'), false);
  assert.equal(desktopMutationAuthorized(null, null), false);
});
