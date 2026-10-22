const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyManagedResourceRelocation,
  createDesktopResourceClient,
  createResourceRowOpenClickHandler,
  createRevealIconClickHandler,
  desktopFileDropAvailable,
  normalizeResourceLocation,
  desktopAddFileAvailable,
  resourceDropMode,
  withResourceLocation
} = require('../public/resourceLocations');

test('one managed relocation updates every matching Canvas and Maintenance reference in memory', () => {
  const previousLocation = {
    type: 'folder', folderId: 'folder_001', relativePath: 'old/D-Glucose.png'
  };
  const page = {
    objects: [{ id: 'object_1', location: previousLocation, x: 10, width: 200 }],
    maintenanceResources: [{ id: 'resource_1', location: previousLocation }],
    blocks: [{ id: 'block_1', objectId: 'object_1' }]
  };
  const changedIds = applyManagedResourceRelocation(page, {
    previousLocation,
    location: {
      type: 'folder', folderId: 'folder_001', relativePath: 'new/D-Glucose.png'
    },
    updatedResourceIds: ['object_1', 'resource_1']
  });
  assert.deepEqual(changedIds, ['object_1', 'resource_1']);
  assert.equal(page.objects[0].location.relativePath, 'new/D-Glucose.png');
  assert.equal(page.maintenanceResources[0].location.relativePath, 'new/D-Glucose.png');
  assert.equal(page.objects[0].id, 'object_1');
  assert.equal(page.objects[0].x, 10);
  assert.equal(page.blocks[0].objectId, 'object_1');
});

test('old src-only resources normalize as vault locations without rewriting the resource', () => {
  const resource = { id: 'resource_old', src: 'assets/resources/model.sdf', visible: false };
  assert.deepEqual(normalizeResourceLocation(resource), {
    type: 'vault',
    relativePath: 'assets/resources/model.sdf'
  });
  assert.equal(resource.location, undefined);
});

test('registered-folder resources keep portable folder identity without absolute paths', () => {
  const resource = {
    id: 'resource_folder',
    location: { type: 'folder', folderId: 'folder_001', relativePath: 'models/A.sdf' }
  };
  assert.deepEqual(normalizeResourceLocation(resource), {
    type: 'folder', folderId: 'folder_001', relativePath: 'models/A.sdf'
  });
  assert.equal(JSON.stringify(resource).includes('/Volumes/'), false);
});

test('resource identity and display state survive a location update', () => {
  const resource = {
    id: 'object_stable',
    src: 'assets/images/old.png',
    visible: true,
    x: 12,
    y: 24,
    width: 300,
    height: 180,
    originalName: 'old.png'
  };
  const page = { blocks: [{ id: 'block_1', objectId: resource.id }] };
  const updated = withResourceLocation(resource, {
    type: 'workspace',
    workspaceId: 'workspace_lab',
    relativePath: 'figures/new.png'
  });

  assert.equal(updated.id, resource.id);
  assert.equal(updated.visible, true);
  assert.equal(updated.x, 12);
  assert.equal(updated.width, 300);
  assert.equal(updated.src, undefined);
  assert.deepEqual(updated.location, {
    type: 'workspace',
    workspaceId: 'workspace_lab',
    relativePath: 'figures/new.png'
  });
  assert.equal(page.blocks[0].objectId, updated.id);
  assert.equal(resource.src, 'assets/images/old.png');
});

test('desktop resource actions are hidden when the desktop bridge is absent', () => {
  const client = createDesktopResourceClient({ getBridge: () => undefined });
  assert.equal(client.canUse({ src: 'assets/images/A.png' }), false);
});

test('Add File is available only through the narrow desktop bridge method', () => {
  assert.equal(desktopAddFileAvailable(undefined), false);
  assert.equal(desktopAddFileAvailable({ isDesktop: true }), false);
  assert.equal(desktopAddFileAvailable({
    isDesktop: true,
    addFiles() {}
  }), true);
});

test('desktop Finder drops use Add File while browser drops retain copy semantics', () => {
  assert.equal(desktopFileDropAvailable(undefined), false);
  assert.equal(resourceDropMode(undefined), 'copy');
  assert.equal(resourceDropMode({ isDesktop: true, addFiles() {} }), 'copy');
  assert.equal(resourceDropMode({ isDesktop: true, addDroppedFiles() {} }), 'link');
});

test('reveal icon stops row actions and invokes reveal exactly once', async () => {
  const calls = [];
  let rowActionCount = 0;
  const event = {
    preventDefaultCalled: false,
    propagationStopped: false,
    preventDefault() { this.preventDefaultCalled = true; },
    stopPropagation() { this.propagationStopped = true; }
  };
  const handler = createRevealIconClickHandler(
    { id: 'resource_1' },
    async (resource) => calls.push(resource.id)
  );
  await handler(event);
  if (!event.propagationStopped) rowActionCount += 1;

  assert.deepEqual(calls, ['resource_1']);
  assert.equal(rowActionCount, 0);
  assert.equal(event.preventDefaultCalled, true);
  assert.equal(event.propagationStopped, true);
});

test('one Maintenance row click immediately opens the original resource once', async () => {
  const calls = [];
  const resource = {
    id: 'resource_psd',
    location: { type: 'folder', folderId: 'folder_001', relativePath: 'source/image.psd' }
  };
  const handler = createResourceRowOpenClickHandler(resource, async (item) => {
    calls.push(item);
  });
  await handler({ type: 'click' });
  assert.deepEqual(calls, [resource]);
});

test('Maintenance row open and magnifier actions remain independently wired', async () => {
  const source = await require('fs/promises').readFile(
    require('path').join(__dirname, '../public/js/rightSidebar.js'),
    'utf8'
  );
  assert.match(source, /item\.addEventListener\('click', resourceLocationsModel\.createResourceRowOpenClickHandler/);
  assert.match(source, /revealButton\.addEventListener\('click', resourceLocationsModel\.createRevealIconClickHandler/);
  assert.doesNotMatch(source, /resource-item[\s\S]{0,500}dblclick/);
});

test('Maintenance rows use the normal clickable cursor without changing native context-menu wiring', async () => {
  const [styles, source] = await Promise.all([
    require('fs/promises').readFile(require('path').join(__dirname, '../public/styles.css'), 'utf8'),
    require('fs/promises').readFile(require('path').join(__dirname, '../public/js/rightSidebar.js'), 'utf8')
  ]);
  assert.match(styles, /\.resource-item-button \{[^}]*cursor: pointer;/);
  assert.doesNotMatch(
    styles,
    /\.resource-item-button\.is-(?:displayable|maintenance-resource)\s*\{[^}]*cursor:\s*context-menu;/
  );
  assert.match(source, /button\.addEventListener\('contextmenu', \(event\) => openResourceContextMenu/);
});

test('icon and context-menu reveal share the same normalized bridge path', async () => {
  const calls = [];
  const bridge = {
    isDesktop: true,
    openVaultResource: async () => ({ ok: true }),
    revealVaultResource: async (location) => {
      calls.push(location);
      return { ok: true };
    }
  };
  const client = createDesktopResourceClient({
    getBridge: () => bridge,
    getPageId: () => 'page_001'
  });
  const resource = { id: 'old_resource', src: 'assets/resources/model.sdf' };
  const reveal = (item) => client.reveal(item);
  const iconHandler = createRevealIconClickHandler(resource, reveal);

  await reveal(resource);
  await iconHandler({ preventDefault() {}, stopPropagation() {} });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[0], {
    pageId: 'page_001',
    resourceId: 'old_resource',
    location: {
      type: 'vault',
      relativePath: 'assets/resources/model.sdf'
    }
  });
});
