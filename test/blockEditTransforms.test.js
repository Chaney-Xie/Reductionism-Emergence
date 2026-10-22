const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

test('Block Edit has one transient selection and new drawing replaces it', async () => {
  const [app, canvas, bootstrap] = await Promise.all([
    read('public/app.js'), read('public/js/canvasBlocks.js'), read('public/js/appBootstrap.js')
  ]);
  assert.match(app, /function createPaneViewContext\(paneId,[^]*?selectedBlockId: null,/);
  assert.doesNotMatch(app, /newDraftBlockIds/);
  assert.match(
    canvas,
    /case BLOCK_MODE\.BLOCK_EDIT:[\s\S]*?semanticSelectedBlockId === block\.id[\s\S]*?BLOCK_STATE\.ACTIVE[\s\S]*?BLOCK_STATE\.HIGHLIGHTED/
  );
  assert.match(canvas, /function enterBlockEditMode\(runtime\)[\s\S]*?runtime\.selectedBlockId = null;[\s\S]*?renderBlockOverlays\(runtime, runtime\.draftBlocks\)/);
  assert.match(canvas, /if \(target\.block\) \{[\s\S]*?setSelectedBlock\(runtime, target\.block\.id\);[\s\S]*?return;/);
  assert.match(canvas, /setSelectedBlock\(runtime, null\);[\s\S]*?runtime\.blockDrawing =/);
  assert.match(canvas, /runtime\.draftBlocks\.push\(block\);[\s\S]*?runtime\.selectedBlockId = block\.id;/);
  assert.match(canvas, /if \(runtime\.blockEditMode && runtime\.selectedBlockId\)[\s\S]*?appendBlockTransformControls/);
  assert.match(bootstrap, /runtime\.blockEditMode && runtime\.selectedBlockId[\s\S]*?event\.key === 'Delete'[\s\S]*?deleteDraftBlock\(runtime, runtime\.selectedBlockId\)/);
});

test('selected Block exposes Block-scoped edge, corner, and rotation controls', async () => {
  const [canvas, css] = await Promise.all([
    read('public/js/canvasBlocks.js'), read('public/styles.css')
  ]);
  for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    assert.match(canvas, new RegExp(`'${handle}'`));
    assert.match(css, new RegExp(`\\.canvas-block-transform-handle\\.is-${handle}`));
  }
  assert.match(canvas, /data\.blockRotationHandle|dataset\.blockRotationHandle/);
  assert.match(css, /\.canvas-block-rotation-handle\s*\{/);
  assert.match(css, /\.canvas-block-transform-controls\s*\{[^}]*outline: 1px solid var\(--accent-colour\)/);
  assert.doesNotMatch(css, /(?:^|,)\s*\.(?:selected|active|editing)\s*\{[^}]*block-transform/ms);
});

test('Block transforms and stacking stay in the working copy until one existing save', async () => {
  const [canvas, server] = await Promise.all([
    read('public/js/canvasBlocks.js'), read('server/appServer.js')
  ]);
  assert.match(canvas, /function updateTransformedBlock[\s\S]*?Object\.assign\(block,[\s\S]*?rotation:/);
  assert.match(canvas, /pageObjectsModel\.resizeRotatedBlock\([\s\S]*?MIN_BLOCK_SIZE/);
  assert.match(canvas, /runtime\.draftBlocks = next;[\s\S]*?setSelectedBlock\(runtime, blockId\)/);
  assert.match(canvas, /body: JSON\.stringify\(\{ blocks: runtime\.draftBlocks \}\)/);
  assert.match(canvas, /runtime\.currentPage\.blocks = cloneBlocks\(runtime\.originalBlocks\)/);
  assert.match(canvas, /runtime\.selectedBlockId = null;/);
  assert.match(server, /const validRotation = block\.rotation === undefined \|\| Number\.isFinite\(block\.rotation\)/);
  assert.match(server, /rotation: block\.rotation === undefined[\s\S]*?existingRotation[\s\S]*?: block\.rotation/);
});
