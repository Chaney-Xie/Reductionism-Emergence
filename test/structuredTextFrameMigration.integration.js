const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createVaultServerContext } = require('../server/appServer');

const APP_ROOT = path.resolve(__dirname, '..');
const LEGACY_FRAME_FIELDS = [
  'markdownFrameOffsetX',
  'markdownFrameWidth',
  'markdownFramePreferredWidth',
  'markdownFrameConstraintSide'
];

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function closeServer(server) {
  if (!server?.vaultServerContext) return;
  await server.vaultServerContext.close();
}

function pageRecord(id, type, extra = {}) {
  return {
    id,
    type,
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
    ...extra
  };
}

async function seedMigrationVault({ irreconcilable = false } = {}) {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-frame-migration-'));
  const pages = [
    pageRecord('page_markdown', 'markdown', {
      markdownBody: '# Markdown',
      textFrame: { preferredWidth: 910 }
    }),
    pageRecord('page_cne', 'cne-text', {
      cneText: {
        schemaVersion: 2,
        revision: 0,
        document: { type: 'doc', content: [] }
      },
      textFrame: { centerWorldX: 125, preferredWidth: 880 }
    }),
    pageRecord('page_cne_default', 'cne-text', {
      cneText: {
        schemaVersion: 2,
        revision: 0,
        document: { type: 'doc', content: [] }
      }
    }),
    pageRecord('page_canvas', 'canvas', {
      textFrame: { centerWorldX: -300, preferredWidth: 600 }
    })
  ];
  if (irreconcilable) {
    pages.push(pageRecord('page_bad_frame', 'markdown', {
      markdownBody: '# Must abort',
      textFrame: { leftWorld: -400, rightWorld: 400 }
    }));
  }

  await writeJson(path.join(vaultRoot, 'vault.json'), {
    vaultId: 'vault_structured_frame_migration',
    displayName: 'Structured Frame Migration',
    schemaVersion: 1,
    createdAt: '2026-09-14T00:00:00.000Z',
    updatedAt: '2026-09-14T00:00:00.000Z',
    defaultPageType: 'markdown',
    lastMarkdownMode: 'live-preview'
  });
  await writeJson(path.join(vaultRoot, 'pageIndex.json'), {
    pages: pages.map((page) => ({
      id: page.id,
      type: page.type,
      title: page.title,
      path: `pages/${page.id}.json`,
      categories: [],
      descriptors: []
    }))
  });
  await writeJson(path.join(vaultRoot, 'navigation.json'), {
    version: 3,
    folders: [],
    items: pages.map((page) => page.id),
    pageStates: {},
    bindings: []
  });
  for (const page of pages) {
    await writeJson(path.join(vaultRoot, 'pages', `${page.id}.json`), page);
  }
  await writeJson(path.join(vaultRoot, 'workspaceState.json'), {
    schemaVersion: 1,
    lastOpenedPageId: 'page_markdown',
    workspaceState: {
      searchText: 'preserve workspace neighbor',
      navigationSortMode: 'modified_desc',
      pageViewStates: {
        page_markdown: {
          panX: 10,
          panY: 20,
          zoom: 2,
          markdownFrameOffsetX: 140,
          markdownFrameWidth: 2222,
          markdownFramePreferredWidth: 333,
          markdownFrameConstraintSide: 'left'
        },
        page_cne: {
          panX: 20,
          panY: -10,
          zoom: 0.5,
          markdownFrameOffsetX: 225,
          markdownFrameWidth: 480,
          markdownFramePreferredWidth: 640,
          markdownFrameConstraintSide: 'right'
        },
        page_canvas: {
          panX: -15,
          zoom: 1,
          markdownFrameOffsetX: 35,
          markdownFrameWidth: 500
        }
      }
    }
  });
  return { pages, vaultRoot };
}

async function start(vaultRoot) {
  const context = createVaultServerContext({
    appRoot: APP_ROOT,
    vaultId: path.basename(vaultRoot),
    vaultRoot
  });
  return context.start({ host: '127.0.0.1', port: 0 });
}

test('cold startup materializes one Page frame, folds legacy offsets into cameras, and is byte-idempotent', async () => {
  const { pages, vaultRoot } = await seedMigrationVault();
  let server = await start(vaultRoot);
  await closeServer(server);

  const storedPages = Object.fromEntries(await Promise.all(pages.map(async (page) => [
    page.id,
    await readJson(path.join(vaultRoot, 'pages', `${page.id}.json`))
  ])));
  assert.deepEqual(storedPages.page_markdown.textFrame, {
    centerWorldX: 0,
    preferredWidth: 910
  }, 'Page-owned preferredWidth seeds canonical Markdown width');
  assert.deepEqual(storedPages.page_cne.textFrame, {
    centerWorldX: 125,
    preferredWidth: 880
  }, 'compatible HN frame remains exact');
  assert.deepEqual(storedPages.page_cne_default.textFrame, {
    centerWorldX: 0,
    preferredWidth: 760
  }, 'HN without a frame receives the shared default');
  assert.equal(Object.hasOwn(storedPages.page_canvas, 'textFrame'), false,
    'Canvas deletes stale structured-text geometry');

  const workspacePath = path.join(vaultRoot, 'workspaceState.json');
  const workspace = await readJson(workspacePath);
  assert.equal(workspace.lastOpenedPageId, 'page_markdown',
    'the Last Opened Page owner is preserved');
  assert.equal(workspace.workspaceState.navigationSortMode, 'modified_desc',
    'the Navigation Sort migration input is preserved raw');
  assert.equal(workspace.workspaceState.searchText, 'preserve workspace neighbor');
  assert.equal(workspace.workspaceState.pageViewStates.page_markdown.panX, 290);
  assert.equal(workspace.workspaceState.pageViewStates.page_cne.panX, 70,
    'legacy offset is folded relative to the non-zero canonical Page centre');
  assert.equal(workspace.workspaceState.pageViewStates.page_canvas.panX, 20);
  for (const viewState of Object.values(workspace.workspaceState.pageViewStates)) {
    for (const field of LEGACY_FRAME_FIELDS) {
      assert.equal(Object.hasOwn(viewState, field), false);
    }
  }
  assert.equal(storedPages.page_markdown.textFrame.preferredWidth, 910,
    'temporary markdownFrameWidth is never promoted into Page geometry');

  const stablePaths = [
    ...pages.map((page) => path.join(vaultRoot, 'pages', `${page.id}.json`)),
    workspacePath
  ];
  const firstStartBytes = await Promise.all(stablePaths.map((filePath) => (
    fs.readFile(filePath, 'utf8')
  )));
  server = await start(vaultRoot);
  await closeServer(server);
  const secondStartBytes = await Promise.all(stablePaths.map((filePath) => (
    fs.readFile(filePath, 'utf8')
  )));
  assert.deepEqual(secondStartBytes, firstStartBytes,
    'restart performs no second frame or camera migration');
});

test('cold startup aborts before any Page/workspace migration write on an irreconcilable frame', async () => {
  const { pages, vaultRoot } = await seedMigrationVault({ irreconcilable: true });
  const protectedPaths = [
    ...pages.map((page) => path.join(vaultRoot, 'pages', `${page.id}.json`)),
    path.join(vaultRoot, 'workspaceState.json')
  ];
  const before = await Promise.all(protectedPaths.map((filePath) => fs.readFile(filePath)));

  await assert.rejects(
    () => start(vaultRoot),
    (error) => {
      assert.equal(error.code, 'IRRECONCILABLE_STRUCTURED_TEXT_FRAME');
      assert.match(error.message, /page_bad_frame/);
      assert.match(error.message, /leftWorld/);
      assert.match(error.message, /rightWorld/);
      return true;
    }
  );

  const after = await Promise.all(protectedPaths.map((filePath) => fs.readFile(filePath)));
  assert.deepEqual(after, before,
    'preflight leaves every Page and the raw workspace byte-identical');
});
