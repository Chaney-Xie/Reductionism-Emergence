const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const vm = require('node:vm');
const imageResolution = require('../public/imageResolution');
const { createDisplayProxyService } = require('../desktop/displayProxyService');

async function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for proxy generation.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function proxyHarness({ generatorDelay = 0 } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-proxy-test-'));
  const sourcePath = path.join(root, 'source.png');
  const cacheRoot = path.join(root, 'cache', 'project_test');
  await fs.writeFile(sourcePath, Buffer.alloc(4096, 7));
  let generationCount = 0;
  const generatedTiers = [];
  const resource = {
    id: 'object_1',
    type: 'image',
    displayable: true,
    naturalWidth: 5906,
    naturalHeight: 4157,
    location: { type: 'folder', folderId: 'folder_1', relativePath: 'source.png' }
  };
  const create = () => createDisplayProxyService({
    vaultId: 'project_test',
    cacheRoot,
    loadResource: async (pageId, objectId) => (
      pageId === 'page_1' && objectId === resource.id ? resource : null
    ),
    resolveLocation: async () => ({ absolutePath: sourcePath }),
    probeImage: async (filePath) => {
      const tier = Number(path.basename(filePath).match(/^(1024|2048|4096)\.png$/)?.[1]);
      return tier
        ? { width: tier, height: Math.round(4157 * tier / 5906) }
        : { width: 5906, height: 4157 };
    },
    generateProxy: async ({ destinationPath, maxLongEdge }) => {
      generationCount += 1;
      generatedTiers.push(maxLongEdge);
      if (generatorDelay) await new Promise((resolve) => setTimeout(resolve, generatorDelay));
      const height = Math.round(4157 * maxLongEdge / 5906);
      await fs.writeFile(destinationPath, Buffer.alloc(maxLongEdge, 3));
      return { width: maxLongEdge, height };
    }
  });
  return {
    cacheRoot,
    create,
    generatedTiers,
    generationCount: () => generationCount,
    root,
    sourcePath
  };
}

test('whole-image tier selection uses transformed CSS size, DPR, and the 1.25 clarity margin', () => {
  assert.equal(imageResolution.physicalLongEdge({ width: 720, height: 506.78 }, 0.8, 2), 1152);
  assert.equal(imageResolution.requiredLongEdge({ width: 720, height: 506.78 }, 0.8, 2), 1440);
  assert.equal(imageResolution.chooseTier(5906, 4157, 700), 1024);
  assert.equal(imageResolution.chooseTier(5906, 4157, 1500), 2048);
  assert.equal(imageResolution.chooseTier(5906, 4157, 2900), 4096);
  assert.equal(imageResolution.chooseTier(5906, 4157, 5000), 'original');
});

test('the immediately lower tier may cover physical pixels without forcing the full clarity margin', () => {
  const object = { width: 720, height: 506.78 };
  const physical = imageResolution.physicalLongEdge(object, 1.3, 2);
  const preferred = imageResolution.requiredLongEdge(object, 1.3, 2);
  assert.equal(physical, 1872);
  assert.equal(preferred, 2340);
  assert.equal(imageResolution.chooseTier(5906, 4157, preferred), 2048);

  assert.equal(imageResolution.chooseTier(5906, 4157, 2420), 4096,
    'the lower tier must cover at least 85% of the preferred edge');
  assert.equal(imageResolution.chooseTier(5906, 4157, 2600), 4096,
    'the lower tier must still cover the physical device-pixel edge');
});

test('tier ladder never upscales and deduplicates tiers equivalent to the original', () => {
  assert.deepEqual(imageResolution.availableTiers(800, 600), ['original']);
  assert.deepEqual(imageResolution.availableTiers(1500, 900), [1024, 'original']);
  assert.deepEqual(imageResolution.availableTiers(3000, 2000), [1024, 2048, 'original']);
  assert.deepEqual(imageResolution.availableTiers(5906, 4157), [1024, 2048, 4096, 'original']);
});

test('an uncached high-resolution request generates 1024 first and then only the required tier', async (t) => {
  const harness = await proxyHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const ready = [];
  const response = await harness.create().requestVariant({
    pageId: 'page_1', objectId: 'object_1', requiredLongEdge: 2900
  }, (event) => ready.push(event));
  assert.equal(response.variant, null);
  assert.equal(response.requestedTier, 4096);
  assert.equal(response.generationPending, true);
  await waitFor(() => ready.length === 2);
  assert.deepEqual(ready.map((event) => event.variant.tier), [1024, 4096]);
  assert.deepEqual(harness.generatedTiers, [1024, 4096]);
  assert.equal(ready[0].variant.width, 1024);
  assert.equal(ready[0].variant.height, 721);
});

test('the default Saccharide fit progresses from 1024 to 2048 instead of 4096', async (t) => {
  const harness = await proxyHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const ready = [];
  const response = await harness.create().requestVariant({
    pageId: 'page_1', objectId: 'object_1', requiredLongEdge: 2340
  }, (event) => ready.push(event));
  assert.equal(response.requestedTier, 2048);
  await waitFor(() => ready.length === 2);
  assert.deepEqual(ready.map((event) => event.variant.tier), [1024, 2048]);
  assert.deepEqual(harness.generatedTiers, [1024, 2048]);
});

test('concurrent requests merge generation and a later service instance reuses the cache', async (t) => {
  const harness = await proxyHarness({ generatorDelay: 20 });
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const service = harness.create();
  const readyA = [];
  const readyB = [];
  await Promise.all([
    service.requestVariant({ pageId: 'page_1', objectId: 'object_1', requiredLongEdge: 700 },
      (event) => readyA.push(event)),
    service.requestVariant({ pageId: 'page_1', objectId: 'object_1', requiredLongEdge: 700 },
      (event) => readyB.push(event))
  ]);
  await waitFor(() => readyA.length === 1 && readyB.length === 1);
  assert.equal(harness.generationCount(), 1);

  const revisit = await harness.create().requestVariant({
    pageId: 'page_1', objectId: 'object_1', requiredLongEdge: 700
  });
  assert.equal(revisit.selectedTier, 1024);
  assert.equal(revisit.generationPending, false);
  assert.equal(harness.generationCount(), 1);
});

test('source fingerprints change with source metadata and cached proxies never mask a missing original', async (t) => {
  const harness = await proxyHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const service = harness.create();
  const ready = [];
  const first = await service.requestVariant({
    pageId: 'page_1', objectId: 'object_1', requiredLongEdge: 700
  }, (event) => ready.push(event));
  await waitFor(() => ready.length === 1);
  const content = await service.prepareContent(first.fingerprint, 1024);
  assert.equal(content.mimeType, 'image/png');

  await fs.appendFile(harness.sourcePath, Buffer.from([9]));
  const changedReady = [];
  const changed = await service.requestVariant({
    pageId: 'page_1', objectId: 'object_1', requiredLongEdge: 700
  }, (event) => changedReady.push(event));
  assert.notEqual(changed.fingerprint, first.fingerprint);
  await waitFor(() => changedReady.length === 1);

  await fs.rm(harness.sourcePath);
  await assert.rejects(
    service.prepareContent(first.fingerprint, 1024),
    (error) => error.code === 'SOURCE_MISSING'
  );
});

test('an invalid cached proxy is regenerated instead of being served', async (t) => {
  const harness = await proxyHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const ready = [];
  await harness.create().requestVariant({
    pageId: 'page_1', objectId: 'object_1', requiredLongEdge: 700
  }, (event) => ready.push(event));
  await waitFor(() => ready.length === 1);
  const fingerprint = ready[0].fingerprint;
  const proxyPath = path.join(harness.cacheRoot, fingerprint, '1024.png');
  const metadataPath = path.join(harness.cacheRoot, fingerprint, '1024.json');
  await fs.writeFile(metadataPath, JSON.stringify({
    version: 1,
    fingerprint,
    tier: 1024,
    width: 1,
    height: 1
  }));
  const secondReady = [];
  const response = await harness.create().requestVariant({
    pageId: 'page_1', objectId: 'object_1', requiredLongEdge: 700
  }, (event) => secondReady.push(event));
  assert.equal(response.variant, null);
  await waitFor(() => secondReady.length === 1);
  assert.equal(harness.generationCount(), 2);
  assert.ok((await fs.stat(proxyPath)).size > 0);
});

test('renderer decodes detached candidates before atomic replacement and keeps geometry logical', async () => {
  const source = await fs.readFile(path.join(__dirname, '../public/js/canvasBlocks.js'), 'utf8');
  assert.match(source, /const CANVAS_IMAGE_RESOLUTION_DEBOUNCE_MS = 150/);
  assert.match(source, /requiredLongEdge\(\s*object,\s*runtime\.canvasView\.scale,\s*globalThis\.devicePixelRatio\s*\)/);
  assert.match(source, /await candidate\.decode\(\)[\s\S]*?previous\.replaceWith\(candidate\)/);
  assert.match(source, /state\.fingerprint !== payload\.fingerprint/);
  assert.match(source, /nextRank < canvasImageTierRank\(state\.currentTier\)/);
  assert.match(source, /checkCanvasImageResolutions\(runtime, \{ validateSource: true \}\)/);
  assert.match(source, /invalidateCanvasImageSource[\s\S]*?removeAttribute\('src'\)/);
  assert.match(source, /layer\.style\.left = `\$\{object\.x\}px`/);
  assert.match(source, /layer\.style\.width = `\$\{object\.width\}px`/);
  assert.match(source, /state\.layerElement\.append\(candidate\)/);
  assert.match(source, /buildCanvasAlphaMask\(object, state, candidate, fingerprint\)/);
});

test('canonical Vault image locations are displayable without a legacy src field', async () => {
  const source = await fs.readFile(path.join(__dirname, '../public/js/canvasBlocks.js'), 'utf8');
  const definition = source.match(/function isDisplayableObject\(object\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(definition, 'isDisplayableObject must remain directly testable');
  const context = {
    globalThis: {},
    resourceLocationsModel: {
      tryNormalizeResourceLocation: (object) => object.location || null
    }
  };
  vm.runInNewContext(
    `${definition}; globalThis.isDisplayableObject = isDisplayableObject;`,
    context
  );

  assert.equal(context.globalThis.isDisplayableObject({
    type: 'image',
    displayable: true,
    location: { type: 'vault', relativePath: 'assets/images/imported.png' }
  }), true);
  assert.equal(context.globalThis.isDisplayableObject({
    type: 'image',
    displayable: true,
    location: { type: 'folder', folderId: 'folder_1', relativePath: 'linked.png' }
  }), true);
  assert.equal(context.globalThis.isDisplayableObject({
    type: 'image',
    displayable: true
  }), false);
});

test('canvas image loading exposes no native filename, icon, or missing-image placeholder', async () => {
  const [source, styles] = await Promise.all([
    fs.readFile(path.join(__dirname, '../public/js/canvasBlocks.js'), 'utf8'),
    fs.readFile(path.join(__dirname, '../public/styles.css'), 'utf8')
  ]);
  assert.match(source, /image\.alt = ''/);
  assert.doesNotMatch(source, /image\.alt = itemLabel|Missing original:|canvas-object-missing/);
  assert.match(source, /slot\.className = 'canvas-object-slot'/);
  assert.match(styles, /\.canvas-object-slot\s*\{[\s\S]*?pointer-events:\s*none/);
  assert.match(styles, /\.canvas-object-image\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(source, /candidate\.src = variant\.displayUrl[\s\S]*?await candidate\.decode\(\)[\s\S]*?previous\.replaceWith\(candidate\)/);
  assert.match(source, /canvasStage\.append\(layer\);[\s\S]*?layer\.append\(slot\);[\s\S]*?if \(reusableImage\)/);
  assert.match(
    source,
    /await globalThis\.cneDesktop\.resolveManagedResource\([\s\S]*?await globalThis\.cneDesktop\.requestDisplayProxy\(/
  );
  assert.doesNotMatch(styles, /\.canvas-object-slot\s*\{[^}]*?(?:border|background|color)\s*:/s);
});

test('desktop bridge exposes only resource identity requests and controlled ready events', async () => {
  const [main, preload, server] = await Promise.all([
    fs.readFile(path.join(__dirname, '../desktop/main.js'), 'utf8'),
    fs.readFile(path.join(__dirname, '../desktop/preload.js'), 'utf8'),
    fs.readFile(path.join(__dirname, '../server/appServer.js'), 'utf8')
  ]);
  assert.match(preload, /requestDisplayProxy: \(request\) => ipcRenderer\.invoke\('cne-desktop:request-display-proxy'/);
  assert.match(preload, /resolveManagedResource: \(request\)[\s\S]*?cne-desktop:resolve-managed-resource/);
  assert.match(preload, /onDisplayProxyReady:[\s\S]*?cne-desktop:display-proxy-ready/);
  assert.match(main, /loadDesktopImageResource\(runtime, pageId, objectId\)/);
  assert.match(main, /display-proxies', runtime\.vaultInfo\.projectId/);
  assert.match(main, /warmImportedDisplayProxies\(runtime, pageId, result\.linked\)/);
  assert.match(main, /function warmImportedDisplayProxies[\s\S]*?requiredLongEdge: 2048/);
  assert.match(main, /displayUrl: `\$\{runtime\.viewerOrigin\}\$\{value\.variant\.displayPath\}`/);
  assert.match(main, /safeMessages[\s\S]*?Display proxy could not be prepared\./);
  assert.match(main, /IPC\.RESOLVE_MANAGED_RESOURCE[\s\S]*?resolveDesktopResourceRequest\(runtime, request\)/);
  assert.match(server, /app\.get\('\/api\/display-proxies\/:fingerprint\/:tier'/);
  assert.doesNotMatch(preload, /displayProxyPath|readFile|writeFile/);
  assert.doesNotMatch(preload, /absolutePath|canonicalPath|sourcePath/);
});
