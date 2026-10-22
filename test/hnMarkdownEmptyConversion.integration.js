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

function pageEnvelope(id, type, ownedContent) {
  return {
    id,
    type,
    title: `${id} title`,
    code: `${id}-code`,
    categories: ['category-preserved'],
    descriptors: { class_preserved: [{ id: 'descriptor-preserved' }] },
    ignoredDescriptors: {},
    ignoredManualEntryIds: {},
    objects: [{ id: `${id}-object`, x: 14, y: 28, width: 60, height: 40 }],
    maintenanceResources: [{ id: `${id}-resource`, originalName: 'preserved.pdf' }],
    externalLinks: [],
    blocks: [],
    highlightGroups: [],
    backlinks: [],
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T01:00:00.000Z',
    ...ownedContent
  };
}

function hnEnvelope(document, revision = 0) {
  return { schemaVersion: 2, revision, document };
}

function sourceHnEnvelope(source, revision = 0) {
  return { schemaVersion: 3, revision, source, anchors: {} };
}

test('server authoritatively converts only empty Markdown and HN documents', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-empty-text-conversion-'));
  const pages = [
    pageEnvelope('markdown_empty', 'markdown', {
      markdownBody: '', textFrame: { preferredWidth: 1337 }
    }),
    pageEnvelope('markdown_whitespace', 'markdown', {
      markdownBody: ' \n', textFrame: { preferredWidth: 760 }
    }),
    pageEnvelope('markdown_stale', 'markdown', {
      markdownBody: '', textFrame: { preferredWidth: 760 }
    }),
    pageEnvelope('cne_runtime_empty', 'cne-text', {
      textFrame: { centerWorldX: 225, preferredWidth: 980 },
      cneText: hnEnvelope({
        type: 'doc',
        content: [{ type: 'paragraph', attrs: { id: 'runtime_empty_paragraph' } }]
      }, 4)
    }),
    pageEnvelope('cne_nonempty', 'cne-text', {
      cneText: sourceHnEnvelope('content')
    }),
    pageEnvelope('cne_stale', 'cne-text', {
      cneText: sourceHnEnvelope('')
    }),
    pageEnvelope('canvas_direct_cne', 'canvas', {
      backlinks: [{ pageId: 'shared-backlink' }]
    }),
    pageEnvelope('cne_direct_canvas', 'cne-text', {
      textFrame: { centerWorldX: 315, preferredWidth: 1040 },
      cneText: sourceHnEnvelope('')
    }),
    pageEnvelope('cne_whitespace_canvas', 'cne-text', {
      cneText: sourceHnEnvelope(' ')
    }),
    pageEnvelope('cne_syntax_canvas', 'cne-text', {
      cneText: sourceHnEnvelope('**x**')
    }),
    pageEnvelope('cne_stale_canvas', 'cne-text', {
      cneText: sourceHnEnvelope('')
    })
  ];
  await writeJson(path.join(vaultRoot, 'vault.json'), {
    vaultId: 'vault_empty_text_conversion',
    displayName: 'Empty Text Conversion',
    schemaVersion: 1,
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
    defaultPageType: 'markdown',
    lastMarkdownMode: 'live-preview'
  });
  await writeJson(path.join(vaultRoot, 'pageIndex.json'), {
    pages: pages.map((page) => ({
      id: page.id,
      type: page.type,
      title: page.title,
      code: page.code,
      path: `pages/${page.id}.json`,
      categories: page.categories,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt
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
    path.join(vaultRoot, `pages/${page.id}.json`),
    page
  )));

  let running = await startIsolatedServer(vaultRoot);
  t.after(async () => {
    if (running?.server?.listening) await closeServer(running.server);
  });

  const emptyMarkdownEligibility = await jsonRequest(
    running.origin,
    '/api/pages/markdown_empty/type-eligibility'
  );
  assert.equal(emptyMarkdownEligibility.response.status, 200);
  assert.equal(emptyMarkdownEligibility.body.targets['cne-text'].allowed, true);
  const toHn = await jsonRequest(running.origin, '/api/pages/markdown_empty/type', {
    method: 'POST', body: JSON.stringify({ type: 'cne-text' })
  });
  assert.equal(toHn.response.status, 200);
  assert.equal(toHn.body.id, 'markdown_empty');
  assert.equal(toHn.body.title, 'markdown_empty title');
  assert.equal(toHn.body.type, 'cne-text');
  assert.deepEqual(toHn.body.cneText, sourceHnEnvelope(''));
  assert.equal(Object.hasOwn(toHn.body, 'markdownBody'), false);
  assert.deepEqual(toHn.body.textFrame, { centerWorldX: 0, preferredWidth: 1337 });
  assert.deepEqual(toHn.body.objects, pages[0].objects);
  assert.deepEqual(toHn.body.maintenanceResources, pages[0].maintenanceResources);
  assert.deepEqual(toHn.body.categories, pages[0].categories);

  const backToMarkdown = await jsonRequest(running.origin, '/api/pages/markdown_empty/type', {
    method: 'POST', body: JSON.stringify({ type: 'markdown' })
  });
  assert.equal(backToMarkdown.response.status, 200);
  assert.equal(backToMarkdown.body.id, 'markdown_empty');
  assert.equal(backToMarkdown.body.title, 'markdown_empty title');
  assert.equal(backToMarkdown.body.type, 'markdown');
  assert.equal(backToMarkdown.body.markdownBody, '');
  assert.deepEqual(backToMarkdown.body.textFrame, { centerWorldX: 0, preferredWidth: 1337 });
  assert.equal(Object.hasOwn(backToMarkdown.body, 'cneText'), false);
  assert.deepEqual(backToMarkdown.body.objects, pages[0].objects);
  assert.deepEqual(backToMarkdown.body.maintenanceResources, pages[0].maintenanceResources);

  const whitespaceEligibility = await jsonRequest(
    running.origin,
    '/api/pages/markdown_whitespace/type-eligibility'
  );
  assert.equal(whitespaceEligibility.body.targets['cne-text'].allowed, false);
  const whitespaceConversion = await jsonRequest(
    running.origin,
    '/api/pages/markdown_whitespace/type',
    { method: 'POST', body: JSON.stringify({ type: 'cne-text' }) }
  );
  assert.equal(whitespaceConversion.response.status, 409);
  assert.equal((await jsonRequest(running.origin, '/api/pages/markdown_whitespace')).body.markdownBody,
    ' \n');

  const runtimeEmptyEligibility = await jsonRequest(
    running.origin,
    '/api/pages/cne_runtime_empty/type-eligibility'
  );
  assert.equal(runtimeEmptyEligibility.body.targets.markdown.allowed, true);
  const runtimeEmptyConversion = await jsonRequest(
    running.origin,
    '/api/pages/cne_runtime_empty/type',
    { method: 'POST', body: JSON.stringify({ type: 'markdown' }) }
  );
  assert.equal(runtimeEmptyConversion.response.status, 200);
  assert.equal(runtimeEmptyConversion.body.markdownBody, '');
  assert.deepEqual(runtimeEmptyConversion.body.textFrame, {
    centerWorldX: 225,
    preferredWidth: 980
  });

  const nonemptyHnEligibility = await jsonRequest(
    running.origin,
    '/api/pages/cne_nonempty/type-eligibility'
  );
  assert.equal(nonemptyHnEligibility.body.targets.markdown.allowed, false);
  const nonemptyHnConversion = await jsonRequest(running.origin, '/api/pages/cne_nonempty/type', {
    method: 'POST', body: JSON.stringify({ type: 'markdown' })
  });
  assert.equal(nonemptyHnConversion.response.status, 409);
  assert.equal((await jsonRequest(running.origin, '/api/pages/cne_nonempty')).body.type, 'cne-text');

  const staleMarkdownEligibility = await jsonRequest(
    running.origin,
    '/api/pages/markdown_stale/type-eligibility'
  );
  assert.equal(staleMarkdownEligibility.body.targets['cne-text'].allowed, true);
  assert.equal((await jsonRequest(running.origin, '/api/pages/markdown_stale', {
    method: 'POST', body: JSON.stringify({ markdownBody: 'new content' })
  })).response.status, 200);
  const staleMarkdownConversion = await jsonRequest(running.origin, '/api/pages/markdown_stale/type', {
    method: 'POST', body: JSON.stringify({ type: 'cne-text' })
  });
  assert.equal(staleMarkdownConversion.response.status, 409);
  const staleMarkdown = (await jsonRequest(running.origin, '/api/pages/markdown_stale')).body;
  assert.equal(staleMarkdown.type, 'markdown');
  assert.equal(staleMarkdown.markdownBody, 'new content');

  const staleHnEligibility = await jsonRequest(
    running.origin,
    '/api/pages/cne_stale/type-eligibility'
  );
  assert.equal(staleHnEligibility.body.targets.markdown.allowed, true);
  const savedStaleHn = await jsonRequest(running.origin, '/api/pages/cne_stale', {
    method: 'POST',
    body: JSON.stringify({
      baseRevision: 0,
      cneText: sourceHnEnvelope('new content')
    })
  });
  assert.equal(savedStaleHn.response.status, 200);
  const staleHnConversion = await jsonRequest(running.origin, '/api/pages/cne_stale/type', {
    method: 'POST', body: JSON.stringify({ type: 'markdown' })
  });
  assert.equal(staleHnConversion.response.status, 409);
  const staleHn = (await jsonRequest(running.origin, '/api/pages/cne_stale')).body;
  assert.equal(staleHn.type, 'cne-text');
  assert.equal(staleHn.cneText.source, 'new content');

  const canvasDirectSource = (
    await jsonRequest(running.origin, '/api/pages/canvas_direct_cne')
  ).body;
  const canvasDirectEligibility = await jsonRequest(
    running.origin,
    '/api/pages/canvas_direct_cne/type-eligibility'
  );
  assert.equal(canvasDirectEligibility.response.status, 200);
  assert.equal(canvasDirectEligibility.body.targets['cne-text'].allowed, true);
  const canvasDirectToHn = await jsonRequest(
    running.origin,
    '/api/pages/canvas_direct_cne/type',
    { method: 'POST', body: JSON.stringify({ type: 'cne-text' }) }
  );
  assert.equal(canvasDirectToHn.response.status, 200);
  assert.equal(canvasDirectToHn.body.id, canvasDirectSource.id);
  assert.equal(canvasDirectToHn.body.type, 'cne-text');
  assert.deepEqual(canvasDirectToHn.body.cneText, sourceHnEnvelope(''));
  assert.deepEqual(canvasDirectToHn.body.textFrame, {
    centerWorldX: 0,
    preferredWidth: 760
  });
  assert.equal(Object.hasOwn(canvasDirectToHn.body, 'markdownBody'), false);
  for (const field of [
    'title', 'code', 'categories', 'descriptors', 'ignoredDescriptors',
    'ignoredManualEntryIds', 'objects', 'maintenanceResources', 'externalLinks',
    'blocks', 'highlightGroups', 'backlinks', 'createdAt'
  ]) {
    assert.deepEqual(canvasDirectToHn.body[field], canvasDirectSource[field], field);
  }
  const canvasDirectStored = JSON.parse(await fs.readFile(
    path.join(vaultRoot, 'pages/canvas_direct_cne.json'),
    'utf8'
  ));
  assert.equal(canvasDirectStored.type, 'cne-text');
  assert.deepEqual(canvasDirectStored.cneText, sourceHnEnvelope(''));

  const hnDirectSource = (
    await jsonRequest(running.origin, '/api/pages/cne_direct_canvas')
  ).body;
  const hnDirectEligibility = await jsonRequest(
    running.origin,
    '/api/pages/cne_direct_canvas/type-eligibility'
  );
  assert.equal(hnDirectEligibility.response.status, 200);
  assert.equal(hnDirectEligibility.body.targets.canvas.allowed, true);
  const hnDirectToCanvas = await jsonRequest(
    running.origin,
    '/api/pages/cne_direct_canvas/type',
    { method: 'POST', body: JSON.stringify({ type: 'canvas' }) }
  );
  assert.equal(hnDirectToCanvas.response.status, 200);
  assert.equal(hnDirectToCanvas.body.id, hnDirectSource.id);
  assert.equal(hnDirectToCanvas.body.type, 'canvas');
  assert.equal(Object.hasOwn(hnDirectToCanvas.body, 'cneText'), false);
  assert.equal(Object.hasOwn(hnDirectToCanvas.body, 'markdownBody'), false);
  assert.equal(Object.hasOwn(hnDirectToCanvas.body, 'textFrame'), false);
  for (const field of [
    'title', 'code', 'categories', 'descriptors', 'ignoredDescriptors',
    'ignoredManualEntryIds', 'objects', 'maintenanceResources', 'externalLinks',
    'blocks', 'highlightGroups', 'backlinks', 'createdAt'
  ]) {
    assert.deepEqual(hnDirectToCanvas.body[field], hnDirectSource[field], field);
  }

  for (const [pageId, exactSource] of [
    ['cne_whitespace_canvas', ' '],
    ['cne_syntax_canvas', '**x**']
  ]) {
    const ineligible = await jsonRequest(
      running.origin,
      `/api/pages/${pageId}/type-eligibility`
    );
    assert.equal(ineligible.body.targets.canvas.allowed, false);
    const rejected = await jsonRequest(running.origin, `/api/pages/${pageId}/type`, {
      method: 'POST', body: JSON.stringify({ type: 'canvas' })
    });
    assert.equal(rejected.response.status, 409);
    const retained = (await jsonRequest(running.origin, `/api/pages/${pageId}`)).body;
    assert.equal(retained.type, 'cne-text');
    assert.equal(retained.cneText.source, exactSource);
  }

  const staleCanvasEligibility = await jsonRequest(
    running.origin,
    '/api/pages/cne_stale_canvas/type-eligibility'
  );
  assert.equal(staleCanvasEligibility.body.targets.canvas.allowed, true);
  const staleCanvasSave = await jsonRequest(running.origin, '/api/pages/cne_stale_canvas', {
    method: 'POST',
    body: JSON.stringify({
      baseRevision: 0,
      cneText: sourceHnEnvelope('persisted after client eligibility')
    })
  });
  assert.equal(staleCanvasSave.response.status, 200);
  const staleCanvasConversion = await jsonRequest(
    running.origin,
    '/api/pages/cne_stale_canvas/type',
    { method: 'POST', body: JSON.stringify({ type: 'canvas' }) }
  );
  assert.equal(staleCanvasConversion.response.status, 409);
  const retainedStaleCanvas = (
    await jsonRequest(running.origin, '/api/pages/cne_stale_canvas')
  ).body;
  assert.equal(retainedStaleCanvas.type, 'cne-text');
  assert.equal(retainedStaleCanvas.cneText.source, 'persisted after client eligibility');

  const index = (await jsonRequest(running.origin, '/api/page-index')).body;
  assert.equal(index.pages.find(({ id }) => id === 'markdown_empty').type, 'markdown');
  assert.equal(index.pages.find(({ id }) => id === 'cne_runtime_empty').type, 'markdown');
  assert.equal(index.pages.find(({ id }) => id === 'canvas_direct_cne').type, 'cne-text');
  assert.equal(index.pages.find(({ id }) => id === 'cne_direct_canvas').type, 'canvas');

  await closeServer(running.server);
  running = await startIsolatedServer(vaultRoot);
  const afterRestart = (await jsonRequest(running.origin, '/api/pages/markdown_empty')).body;
  assert.equal(afterRestart.type, 'markdown');
  assert.equal(afterRestart.title, 'markdown_empty title');
  assert.equal(afterRestart.markdownBody, '');
  assert.deepEqual(afterRestart.textFrame, { centerWorldX: 0, preferredWidth: 1337 });
  assert.equal(Object.hasOwn(afterRestart, 'cneText'), false);
  assert.deepEqual(afterRestart.objects, pages[0].objects);
  assert.deepEqual(afterRestart.maintenanceResources, pages[0].maintenanceResources);

  const canvasToHnAfterRestart = (
    await jsonRequest(running.origin, '/api/pages/canvas_direct_cne')
  ).body;
  assert.equal(canvasToHnAfterRestart.type, 'cne-text');
  assert.deepEqual(canvasToHnAfterRestart.cneText, sourceHnEnvelope(''));
  assert.deepEqual(canvasToHnAfterRestart.textFrame, {
    centerWorldX: 0,
    preferredWidth: 760
  });
  assert.deepEqual(canvasToHnAfterRestart.objects, canvasDirectSource.objects);
  assert.deepEqual(
    canvasToHnAfterRestart.maintenanceResources,
    canvasDirectSource.maintenanceResources
  );
  const hnToCanvasAfterRestart = (
    await jsonRequest(running.origin, '/api/pages/cne_direct_canvas')
  ).body;
  assert.equal(hnToCanvasAfterRestart.type, 'canvas');
  assert.equal(Object.hasOwn(hnToCanvasAfterRestart, 'cneText'), false);
  assert.equal(Object.hasOwn(hnToCanvasAfterRestart, 'textFrame'), false);
  assert.deepEqual(hnToCanvasAfterRestart.objects, hnDirectSource.objects);
});
