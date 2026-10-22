const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function block(id, colour, extra = {}) {
  return {
    id,
    objectId: 'object_1',
    x: 10,
    y: 10,
    width: 80,
    height: 40,
    rotation: 0,
    links: [],
    ...(colour === undefined ? {} : { colour }),
    ...extra
  };
}

test('preset edits are conflict-safe and Global Apply migrates only exact stored Block colours', async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-block-colour-preset-http-'));
  const appearancePath = path.join(vaultRoot, 'appearance.json');
  const pageIndexPath = path.join(vaultRoot, 'pageIndex.json');
  const pagePaths = {
    page_a: path.join(vaultRoot, 'pages/page-a.json'),
    page_b: path.join(vaultRoot, 'pages/page-b.json'),
    page_c: path.join(vaultRoot, 'pages/page-c.json')
  };
  await writeJson(path.join(vaultRoot, 'vault.json'), {
    projectId: 'project_block_colours',
    projectName: 'Block Colours',
    version: '0.2.2',
    lastOpenedPageId: 'page_a'
  });
  const appearance = {
    blockAppearance: {
      colourful: true,
      colourfulBlock: {
        presets: [
          { id: 'preset_primary', colour: '#A1B2C3' },
          { id: 'preset_other', colour: '#445566' }
        ],
        lastUsedColour: '#ABCDEF'
      },
      monochrome: {
        colour: '#6785A3',
        opacity: { status1: 0.1, status2: 0.4, status3: 0.8 },
        borderWidth: 2
      }
    }
  };
  await writeJson(appearancePath, appearance);
  await writeJson(pageIndexPath, {
    schemaVersion: 7,
    futureIndexField: { retained: true },
    pages: Object.keys(pagePaths).map((id) => ({
      id,
      title: id,
      path: `pages/${id.replace('_', '-')}.json`,
      updatedAt: '2026-01-01T00:00:00.000Z',
      futureEntryField: id
    }))
  });
  await writeJson(pagePaths.page_a, {
    id: 'page_a',
    title: 'Page A',
    futurePageField: { retained: 'a' },
    objects: [{ id: 'object_1', type: 'image', x: 0, y: 0, width: 200, height: 100 }],
    blocks: [
      block('block_a_1', '#A1B2C3', { futureBlockField: 'retained' }),
      block('block_a_2', '#a1b2c3'),
      block('block_a_other', '#445566'),
      block('block_a_colourless')
    ]
  });
  await writeJson(pagePaths.page_b, {
    id: 'page_b',
    title: 'Page B',
    objects: [{ id: 'object_1', type: 'image', x: 0, y: 0, width: 200, height: 100 }],
    blocks: [block('block_b_1', '#A1B2C3')]
  });
  await writeJson(pagePaths.page_c, {
    id: 'page_c',
    title: 'Page C',
    objects: [{ id: 'object_1', type: 'image', x: 0, y: 0, width: 200, height: 100 }],
    blocks: [block('block_c_1', '#778899')]
  });

  process.env.VIEWER_ROOT = vaultRoot;
  process.env.VIEWER_APP_ROOT = path.resolve(__dirname, '..');
  const { startServer } = require('../server/appServer');
  const server = await startServer({ host: '127.0.0.1', port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const editPreset = (body) => fetch(
    `${origin}/api/appearance/block-colour-presets/preset_primary`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }
  );

  const bytesBeforeConflicts = {
    appearance: await fs.readFile(appearancePath, 'utf8'),
    pageA: await fs.readFile(pagePaths.page_a, 'utf8'),
    index: await fs.readFile(pageIndexPath, 'utf8')
  };
  const stale = await editPreset({
    expectedColour: '#000000', colour: '#223344', globalApply: true
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).currentColour, '#A1B2C3');
  const collision = await editPreset({
    expectedColour: '#A1B2C3', colour: '#445566', globalApply: true
  });
  assert.equal(collision.status, 409);
  assert.equal(await fs.readFile(appearancePath, 'utf8'), bytesBeforeConflicts.appearance);
  assert.equal(await fs.readFile(pagePaths.page_a, 'utf8'), bytesBeforeConflicts.pageA);
  assert.equal(await fs.readFile(pageIndexPath, 'utf8'), bytesBeforeConflicts.index);

  const pageCBefore = await fs.readFile(pagePaths.page_c, 'utf8');
  const appliedResponse = await editPreset({
    expectedColour: '#A1B2C3', colour: '#778899', globalApply: true
  });
  assert.equal(appliedResponse.status, 200);
  const applied = await appliedResponse.json();
  assert.deepEqual(applied.changedPageIds, ['page_a', 'page_b']);
  assert.equal(applied.changedBlockCount, 3);
  assert.equal(applied.globalApply, true);
  assert.deepEqual(applied.pages.map((page) => page.id), ['page_a', 'page_b']);
  assert.equal(applied.pageIndex.futureIndexField.retained, true);

  const savedAppearance = JSON.parse(await fs.readFile(appearancePath, 'utf8'));
  assert.equal(
    savedAppearance.blockAppearance.colourfulBlock.presets[0].colour,
    '#778899'
  );
  assert.equal(
    savedAppearance.blockAppearance.colourfulBlock.lastUsedColour,
    '#ABCDEF'
  );
  assert.deepEqual(savedAppearance.blockAppearance.monochrome.opacity, {
    status1: 0.1, status2: 0.4, status3: 0.8
  });

  const savedPageA = JSON.parse(await fs.readFile(pagePaths.page_a, 'utf8'));
  const savedPageB = JSON.parse(await fs.readFile(pagePaths.page_b, 'utf8'));
  const savedIndex = JSON.parse(await fs.readFile(pageIndexPath, 'utf8'));
  assert.deepEqual(savedPageA.blocks.map((item) => item.colour), [
    '#778899', '#778899', '#445566', undefined
  ]);
  assert.equal(savedPageA.futurePageField.retained, 'a');
  assert.equal(savedPageA.blocks[0].futureBlockField, 'retained');
  assert.equal(savedPageB.blocks[0].colour, '#778899');
  assert.equal(await fs.readFile(pagePaths.page_c, 'utf8'), pageCBefore);
  assert.equal(savedIndex.futureIndexField.retained, true);
  assert.equal(
    savedIndex.pages.find((entry) => entry.id === 'page_a').futureEntryField,
    'page_a'
  );
  assert.equal(savedPageA.updatedAt, savedIndex.pages.find((entry) => entry.id === 'page_a').updatedAt);
  assert.equal(savedPageB.updatedAt, savedIndex.pages.find((entry) => entry.id === 'page_b').updatedAt);

  const rollbackBefore = {
    appearance: await fs.readFile(appearancePath, 'utf8'),
    pageA: await fs.readFile(pagePaths.page_a, 'utf8'),
    pageB: await fs.readFile(pagePaths.page_b, 'utf8'),
    pageC: await fs.readFile(pagePaths.page_c, 'utf8'),
    pageIndex: await fs.readFile(pageIndexPath, 'utf8')
  };
  const originalRename = fs.rename;
  let deniedPageIndexPublication = false;
  fs.rename = async (source, destination) => {
    if (!deniedPageIndexPublication && path.resolve(destination) === pageIndexPath) {
      deniedPageIndexPublication = true;
      throw Object.assign(new Error(`EACCES: permission denied, rename '${pageIndexPath}'`), {
        code: 'EACCES',
        errno: -13,
        path: pageIndexPath,
        syscall: 'rename'
      });
    }
    return originalRename.call(fs, source, destination);
  };
  let rollbackResponse;
  try {
    rollbackResponse = await editPreset({
      expectedColour: '#778899', colour: '#8899AA', globalApply: true
    });
  } finally {
    fs.rename = originalRename;
  }
  assert.equal(deniedPageIndexPublication, true);
  assert.equal(rollbackResponse.status, 500);
  assert.equal(await fs.readFile(appearancePath, 'utf8'), rollbackBefore.appearance);
  assert.equal(await fs.readFile(pagePaths.page_a, 'utf8'), rollbackBefore.pageA);
  assert.equal(await fs.readFile(pagePaths.page_b, 'utf8'), rollbackBefore.pageB);
  assert.equal(await fs.readFile(pagePaths.page_c, 'utf8'), rollbackBefore.pageC);
  assert.equal(await fs.readFile(pageIndexPath, 'utf8'), rollbackBefore.pageIndex);

  const pagesBeforeLocalEdit = await Promise.all(
    Object.values(pagePaths).map((filePath) => fs.readFile(filePath, 'utf8'))
  );
  const indexBeforeLocalEdit = await fs.readFile(pageIndexPath, 'utf8');
  await fs.rm(pageIndexPath);
  const localResponse = await editPreset({
    expectedColour: '#778899', colour: '#8899AA', globalApply: false
  });
  assert.equal(localResponse.status, 200);
  const localResult = await localResponse.json();
  assert.deepEqual(localResult.pages, []);
  assert.equal(localResult.pageIndex, null);
  assert.equal(localResult.changedBlockCount, 0);
  assert.deepEqual(
    await Promise.all(Object.values(pagePaths).map((filePath) => fs.readFile(filePath, 'utf8'))),
    pagesBeforeLocalEdit
  );
  await assert.rejects(fs.access(pageIndexPath), { code: 'ENOENT' });

  await fs.writeFile(pageIndexPath, '{"pages":', 'utf8');
  const malformedLocalResponse = await editPreset({
    expectedColour: '#8899AA', colour: '#99AABB', globalApply: false
  });
  assert.equal(malformedLocalResponse.status, 200);
  const malformedLocalResult = await malformedLocalResponse.json();
  assert.deepEqual(malformedLocalResult.pages, []);
  assert.equal(malformedLocalResult.pageIndex, null);
  assert.equal(await fs.readFile(pageIndexPath, 'utf8'), '{"pages":');

  await fs.writeFile(pageIndexPath, indexBeforeLocalEdit, 'utf8');

  const malformedIndex = JSON.parse(indexBeforeLocalEdit);
  malformedIndex.pages.push({
    id: 'page_missing', title: 'Missing', path: 'pages/missing.json'
  });
  await writeJson(pageIndexPath, malformedIndex);
  const appearanceBeforeMalformed = await fs.readFile(appearancePath, 'utf8');
  const pagesBeforeMalformed = await Promise.all(
    Object.values(pagePaths).map((filePath) => fs.readFile(filePath, 'utf8'))
  );
  const malformed = await editPreset({
    expectedColour: '#99AABB', colour: '#AABBCC', globalApply: true
  });
  assert.equal(malformed.status, 409);
  assert.equal(await fs.readFile(appearancePath, 'utf8'), appearanceBeforeMalformed);
  assert.deepEqual(
    await Promise.all(Object.values(pagePaths).map((filePath) => fs.readFile(filePath, 'utf8'))),
    pagesBeforeMalformed
  );

  malformedIndex.pages.pop();
  await writeJson(pageIndexPath, malformedIndex);
  const blockEdit = await fetch(`${origin}/api/pages/page_a`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      blocks: [
        { ...savedPageA.blocks[0], colour: undefined },
        { ...savedPageA.blocks[1], colour: '#aabbcc' },
        savedPageA.blocks[2],
        savedPageA.blocks[3]
      ]
    })
  });
  assert.equal(blockEdit.status, 200);
  const blockEditResult = (await blockEdit.json()).page;
  assert.equal(blockEditResult.blocks[0].colour, '#778899');
  assert.equal(blockEditResult.blocks[1].colour, '#AABBCC');

  const beforeInvalidBlock = await fs.readFile(pagePaths.page_a, 'utf8');
  const invalidBlock = await fetch(`${origin}/api/pages/page_a`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blocks: [{ ...blockEditResult.blocks[0], colour: 'red' }] })
  });
  assert.equal(invalidBlock.status, 400);
  assert.equal(await fs.readFile(pagePaths.page_a, 'utf8'), beforeInvalidBlock);
});
