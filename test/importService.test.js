const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createImportService } = require('../server/importService');

function pngBuffer(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

test('import service preserves duplicate/replace behavior after extraction', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-import-service-'));
  const imageAssetsDir = path.join(root, 'assets', 'images');
  const resourceAssetsDir = path.join(root, 'assets', 'resources');
  const service = createImportService({
    imageAssetsDir,
    resourceAssetsDir,
    localAssetFilePath: () => null
  });
  const page = {
    id: 'page_test',
    objects: [],
    maintenanceResources: [],
    blocks: []
  };

  try {
    const firstFile = {
      originalName: 'A.png',
      mimeType: 'image/png',
      buffer: pngBuffer(100, 50),
      size: 24
    };
    const first = await service.importFileToPage(page, firstFile, 'canvas', '2026-01-01T00:00:00.000Z');
    const originalId = first.item.id;
    assert.deepEqual(first.item.location, {
      type: 'vault',
      relativePath: first.item.src
    });

    await assert.rejects(
      service.importFileToPage(page, { ...firstFile, buffer: pngBuffer(120, 60) }, 'canvas', '2026-01-02T00:00:00.000Z'),
      (error) => error.status === 409 && error.duplicate?.id === originalId
    );
    assert.equal(page.objects.length, 1);

    const replacement = await service.importFileToPage(
      page,
      { ...firstFile, buffer: pngBuffer(120, 60) },
      'canvas',
      '2026-01-02T00:00:00.000Z',
      { replaceItemId: originalId, replaceItemKind: 'object' }
    );
    assert.equal(replacement.item.id, originalId);
    assert.deepEqual(replacement.item.location, {
      type: 'vault',
      relativePath: replacement.item.src
    });
    assert.equal(page.objects.length, 1);
    assert.equal(replacement.item.naturalWidth, 120);
    assert.equal(replacement.item.cacheBuster, '2026-01-02T00:00:00.000Z');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('imported filename normalization repairs common UTF-8 mojibake', () => {
  const service = createImportService({
    imageAssetsDir: '/tmp/viewer-unused-images',
    resourceAssetsDir: '/tmp/viewer-unused-resources',
    localAssetFilePath: () => null
  });

  assert.equal(
    service.normalizeImportedFilename('æ®ç-1-StructuralBiochem.png'),
    '普生-1-StructuralBiochem.png'
  );
});

test('linked originals create portable display objects and Maintenance-only resources atomically', () => {
  const service = createImportService({
    imageAssetsDir: '/tmp/viewer-unused-images',
    resourceAssetsDir: '/tmp/viewer-unused-resources',
    localAssetFilePath: () => null
  });
  const page = {
    id: 'page_linked',
    objects: [],
    maintenanceResources: [],
    blocks: []
  };
  const linked = service.linkOriginalFilesToPage(page, [{
    location: { type: 'workspace', workspaceId: 'workspace_lab', relativePath: 'images/A.png' },
    mimeType: 'image/png',
    size: 24,
    buffer: pngBuffer(1200, 600)
  }, {
    location: { type: 'workspace', workspaceId: 'workspace_lab', relativePath: 'models/B.sdf' },
    mimeType: 'application/octet-stream',
    size: 20,
    buffer: null
  }], '2026-07-16T00:00:00.000Z');

  assert.equal(linked.length, 2);
  assert.equal(page.objects.length, 1);
  assert.equal(page.maintenanceResources.length, 1);
  assert.equal(page.objects[0].id, 'object_linked_001');
  assert.equal(page.objects[0].src, undefined);
  assert.equal(page.objects[0].naturalWidth, 1200);
  assert.equal(page.objects[0].width, 720);
  assert.deepEqual(page.objects[0].location, {
    type: 'workspace', workspaceId: 'workspace_lab', relativePath: 'images/A.png'
  });
  assert.equal(page.maintenanceResources[0].id, 'resource_linked_001');
  assert.equal(page.maintenanceResources[0].displayable, false);
  assert.equal(JSON.stringify(page).includes('/tmp/'), false);
});

test('linked-original duplicate validation aborts before mutating the page', () => {
  const service = createImportService({
    imageAssetsDir: '/tmp/viewer-unused-images',
    resourceAssetsDir: '/tmp/viewer-unused-resources',
    localAssetFilePath: () => null
  });
  const page = {
    id: 'page_linked_duplicate',
    objects: [],
    maintenanceResources: [],
    blocks: []
  };
  assert.throws(() => service.linkOriginalFilesToPage(page, [{
    location: { type: 'workspace', workspaceId: 'workspace_lab', relativePath: 'A.png' },
    mimeType: 'image/png', buffer: pngBuffer(100, 50), size: 24
  }, {
    location: { type: 'workspace', workspaceId: 'workspace_lab', relativePath: 'nested/A.png' },
    mimeType: 'image/png', buffer: pngBuffer(120, 60), size: 24
  }], '2026-07-16T00:00:00.000Z'), /already exists/i);
  assert.equal(page.objects.length, 0);
  assert.equal(page.maintenanceResources.length, 0);
});

test('multi-image linking centres and stacks new Objects in file order without tiling', () => {
  const service = createImportService({
    imageAssetsDir: '/tmp/viewer-unused-images',
    resourceAssetsDir: '/tmp/viewer-unused-resources',
    localAssetFilePath: () => null
  });
  const page = {
    id: 'page_stack',
    objects: [{
      id: 'object_existing', type: 'image', displayable: true,
      x: 10, y: 20, width: 100, height: 50
    }],
    maintenanceResources: [], blocks: []
  };
  service.linkOriginalFilesToPage(page, [{
    location: { type: 'workspace', workspaceId: 'workspace_lab', relativePath: 'B.png' },
    mimeType: 'image/png', buffer: pngBuffer(400, 200), size: 24
  }, {
    location: { type: 'workspace', workspaceId: 'workspace_lab', relativePath: 'C.png' },
    mimeType: 'image/png', buffer: pngBuffer(200, 400), size: 24
  }], '2026-07-24T00:00:00.000Z', { placementCenter: { x: 500, y: 300 } });

  assert.deepEqual(page.objects.map((object) => object.originalName || object.id), [
    'object_existing', 'B.png', 'C.png'
  ]);
  for (const object of page.objects.slice(1)) {
    assert.equal(object.x + object.width / 2, 500);
    assert.equal(object.y + object.height / 2, 300);
  }
});

test('one image on an empty Page preserves the established origin placement', () => {
  const service = createImportService({
    imageAssetsDir: '/tmp/viewer-unused-images',
    resourceAssetsDir: '/tmp/viewer-unused-resources',
    localAssetFilePath: () => null
  });
  const page = { id: 'page_single', objects: [], maintenanceResources: [], blocks: [] };
  service.linkOriginalFilesToPage(page, [{
    location: { type: 'workspace', workspaceId: 'workspace_lab', relativePath: 'A.png' },
    mimeType: 'image/png', buffer: pngBuffer(100, 50), size: 24
  }], '2026-07-24T00:00:00.000Z', { placementCenter: { x: 500, y: 300 } });
  assert.equal(page.objects[0].x, 0);
  assert.equal(page.objects[0].y, 0);
});

test('one image dropped on a Markdown Page is centred at the supplied world position', () => {
  const service = createImportService({
    imageAssetsDir: '/tmp/viewer-unused-images',
    resourceAssetsDir: '/tmp/viewer-unused-resources',
    localAssetFilePath: () => null
  });
  const page = {
    id: 'page_markdown_drop',
    type: 'markdown',
    markdownBody: 'Existing Markdown body',
    objects: [],
    maintenanceResources: [],
    blocks: []
  };

  service.linkOriginalFilesToPage(page, [{
    location: { type: 'workspace', workspaceId: 'workspace_lab', relativePath: 'Dropped.png' },
    mimeType: 'image/png', buffer: pngBuffer(100, 50), size: 24
  }], '2026-08-03T00:00:00.000Z', {
    placementCenter: { x: 500, y: 300 },
    placementId: 'markdown-document'
  });

  assert.equal(page.objects.length, 1);
  assert.equal(page.objects[0].x + page.objects[0].width / 2, 500);
  assert.equal(page.objects[0].y + page.objects[0].height / 2, 300);
  assert.equal(page.markdownBody, 'Existing Markdown body');
  assert.deepEqual(page.objects[0].location, {
    type: 'workspace', workspaceId: 'workspace_lab', relativePath: 'Dropped.png'
  });
});

test('Markdown image drops clamp the Object top to the document top without changing Canvas placement', () => {
  const service = createImportService({
    imageAssetsDir: '/tmp/viewer-unused-images',
    resourceAssetsDir: '/tmp/viewer-unused-resources',
    localAssetFilePath: () => null
  });
  const markdownPage = {
    id: 'page_markdown_top_drop',
    type: 'markdown',
    markdownBody: 'Canonical Markdown body',
    objects: [],
    maintenanceResources: [],
    blocks: []
  };
  const canvasPage = {
    id: 'page_canvas_top_drop',
    type: 'canvas',
    objects: [{
      id: 'object_existing', type: 'image', displayable: true,
      x: 0, y: 0, width: 10, height: 10
    }],
    maintenanceResources: [],
    blocks: []
  };
  const linkedImage = {
    location: { type: 'workspace', workspaceId: 'workspace_lab', relativePath: 'NearTop.png' },
    mimeType: 'image/png',
    buffer: pngBuffer(100, 50),
    size: 24
  };
  const placementCenter = { x: 500, y: 10 };

  service.linkOriginalFilesToPage(
    markdownPage,
    [linkedImage],
    '2026-08-04T00:00:00.000Z',
    { placementCenter, placementId: 'markdown-document' }
  );
  service.linkOriginalFilesToPage(
    canvasPage,
    [linkedImage],
    '2026-08-04T00:00:00.000Z',
    { placementCenter }
  );

  const markdownObject = markdownPage.objects[0];
  const canvasObject = canvasPage.objects.at(-1);
  assert.equal(markdownObject.x + markdownObject.width / 2, placementCenter.x);
  assert.equal(markdownObject.y, 0);
  assert.equal(markdownPage.markdownBody, 'Canonical Markdown body');
  assert.deepEqual(markdownObject.location, linkedImage.location);
  assert.equal(canvasObject.x + canvasObject.width / 2, placementCenter.x);
  assert.equal(canvasObject.y, -15);
});
