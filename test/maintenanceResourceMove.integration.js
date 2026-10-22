const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createManagedResourceRelocator } = require('../desktop/managedResourceRelocator');
const { resolveResourceLocation } = require('../desktop/vaultPaths');

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('a moved Maintenance resource with stale size resolves and atomically persists its exact path', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-maintenance-move-vault-'));
  const folderRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-maintenance-move-folder-'));
  t.after(() => Promise.all([
    fs.rm(vaultRoot, { recursive: true, force: true }),
    fs.rm(folderRoot, { recursive: true, force: true })
  ]));

  const pageId = 'page_maintenance_move';
  const resourceId = 'resource_maintenance_move';
  const pagePath = path.join(vaultRoot, 'pages/maintenance-move.json');
  const originalRelativePath = 'models/current/model.sdf';
  const movedRelativePath = 'models/archive/model.sdf';
  const originalAbsolutePath = path.join(folderRoot, originalRelativePath);
  const movedAbsolutePath = path.join(folderRoot, movedRelativePath);
  const originalContents = 'initial';
  await fs.mkdir(path.dirname(originalAbsolutePath), { recursive: true });
  await fs.writeFile(originalAbsolutePath, originalContents);

  const registeredFolder = { id: 'folder_001', name: 'Models' };
  const beforeEntry = {
    id: resourceId,
    type: 'file',
    resourceType: 'sdf',
    location: {
      type: 'folder',
      folderId: registeredFolder.id,
      relativePath: originalRelativePath
    },
    originalName: 'model.sdf',
    fileName: 'model.sdf',
    displayable: false,
    size: Buffer.byteLength(originalContents)
  };
  await writeJson(path.join(vaultRoot, 'vault.json'), {
    projectId: 'project_maintenance_move',
    projectName: 'Maintenance Move',
    version: '0.2.2',
    lastOpenedPageId: pageId
  });
  await writeJson(path.join(vaultRoot, 'pageIndex.json'), {
    pages: [{ id: pageId, title: 'Maintenance Move', path: 'pages/maintenance-move.json' }]
  });
  await writeJson(path.join(vaultRoot, 'navigation.json'), {
    version: 2,
    folders: [],
    items: [pageId]
  });
  await writeJson(pagePath, {
    id: pageId,
    title: 'Maintenance Move',
    categories: [],
    descriptors: [],
    objects: [],
    maintenanceResources: [beforeEntry],
    blocks: [],
    backlinks: [],
    highlightGroups: [],
    externalLinks: []
  });
  await fs.mkdir(path.join(vaultRoot, 'assets/images'), { recursive: true });
  await fs.mkdir(path.join(vaultRoot, 'assets/resources'), { recursive: true });

  const folderRegistry = {
    version: 1,
    folders: [registeredFolder],
    defaultFolderId: registeredFolder.id
  };
  const folderRoots = { [registeredFolder.id]: folderRoot };
  const resolveDirect = (location) => resolveResourceLocation(vaultRoot, location, {
    folderRegistry,
    folderRoots
  });
  let origin = '';
  const token = 'maintenance-move-token-123456';
  const relocator = createManagedResourceRelocator({
    resolveDirect,
    managedRoot: async (location) => ({
      rootPath: folderRoots[location.folderId],
      toLocation: (relativePath) => ({
        type: 'folder',
        folderId: location.folderId,
        relativePath
      })
    }),
    persistRelocation: async (payload) => {
      const response = await fetch(
        `${origin}/api/pages/${payload.pageId}/resources/${payload.resourceId}/location`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            'x-viewer-desktop-token': token
          },
          body: JSON.stringify({
            previousLocation: payload.previousLocation,
            nextLocation: payload.nextLocation
          })
        }
      );
      const body = await response.json();
      assert.equal(response.status, 200, body.error);
      return body;
    }
  });

  process.env.VIEWER_ROOT = vaultRoot;
  process.env.VIEWER_APP_ROOT = path.resolve(__dirname, '..');
  const { startServer } = require('../server/appServer');
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    desktopMutationToken: token,
    resourceResolver: (location, context) => relocator.resolve(location, context)
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  origin = `http://127.0.0.1:${server.address().port}`;
  const contentUrl = `${origin}/api/pages/${pageId}/resources/${resourceId}/content`;

  const initiallyAvailable = await fetch(contentUrl, { method: 'HEAD' });
  assert.equal(initiallyAvailable.status, 200);

  const changedContents = 'externally edited Maintenance resource';
  await fs.writeFile(originalAbsolutePath, changedContents);
  await fs.mkdir(path.dirname(movedAbsolutePath), { recursive: true });
  await fs.rename(originalAbsolutePath, movedAbsolutePath);

  const afterMove = await fetch(contentUrl, { method: 'HEAD' });
  assert.equal(afterMove.status, 200);
  const realMovedPath = await fs.realpath(movedAbsolutePath);

  const savedPage = JSON.parse(await fs.readFile(pagePath, 'utf8'));
  const afterEntry = savedPage.maintenanceResources.find((item) => item.id === resourceId);
  assert.deepEqual(afterEntry.location, {
    type: 'folder',
    folderId: registeredFolder.id,
    relativePath: movedRelativePath
  });
  assert.equal(afterEntry.originalName, beforeEntry.originalName);
  assert.equal(afterEntry.fileName, beforeEntry.fileName);
  assert.equal(afterEntry.size, Buffer.byteLength(changedContents));

  const finalResolution = await resolveDirect(afterEntry.location);
  assert.equal(finalResolution.absolutePath, realMovedPath);
});
