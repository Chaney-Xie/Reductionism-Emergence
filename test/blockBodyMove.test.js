const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const read = (relativePath) => fs.readFile(path.join(__dirname, '..', relativePath), 'utf8');

const functionSource = (source, name, nextName) => source.slice(
  source.indexOf(`function ${name}`),
  source.indexOf(`function ${nextName}`)
);

test('Block Edit pointer priority is rotation, resize, topmost body, then empty drawing territory', async () => {
  const [app, canvas] = await Promise.all([
    read('public/app.js'), read('public/js/canvasBlocks.js')
  ]);
  assert.match(app, /const BLOCK_MOVE_THRESHOLD = 3;/);
  const handler = functionSource(canvas, 'handleBlockPointerDown', 'handleBlockPointerMove');
  const rotationIndex = handler.indexOf("'[data-block-rotation-handle]'");
  const resizeIndex = handler.indexOf("'[data-block-resize-handle]'");
  const bodyIndex = handler.indexOf('if (target.block)');
  const drawingIndex = handler.indexOf('blockDrawing =');
  assert.ok(rotationIndex >= 0 && rotationIndex < resizeIndex);
  assert.ok(resizeIndex < bodyIndex);
  assert.ok(bodyIndex < drawingIndex);
  assert.match(handler, /setSelectedBlock\(runtime, target\.block\.id\);[\s\S]*?beginBlockTransform\(runtime, event, target\.block, 'move'\)/);
  assert.match(handler, /setSelectedBlock\(runtime, null\);[\s\S]*?runtime\.blockDrawing =/);
});

test('Block body movement waits for a screen-pixel threshold then translates only x and y', async () => {
  const canvas = await read('public/js/canvasBlocks.js');
  const updater = functionSource(canvas, 'updateBlockTransform', 'finishBlockTransform');
  assert.match(updater, /transform\.type === 'move'/);
  assert.match(updater, /Math\.hypot\([\s\S]*?event\.clientX - transform\.startClient\.x[\s\S]*?event\.clientY - transform\.startClient\.y/);
  assert.match(updater, /clientDistance < BLOCK_MOVE_THRESHOLD\) return true/);
  assert.match(updater, /\.\.\.transform\.startBlock,[\s\S]*?x: transform\.startBlock\.x \+ point\.x - transform\.startPoint\.x,[\s\S]*?y: transform\.startBlock\.y \+ point\.y - transform\.startPoint\.y/);
  assert.doesNotMatch(updater.match(/if \(transform\.type === 'move'\)[\s\S]*?return true;/)?.[0] || '', /reorderBlocks|rotation\s*:|width\s*:|height\s*:/);
});

test('Block body move shares transform pointer capture and working-copy cancellation', async () => {
  const canvas = await read('public/js/canvasBlocks.js');
  assert.match(canvas, /function beginBlockTransform\(runtime,[\s\S]*?runtime\.dom\.canvasArea\.setPointerCapture\(event\.pointerId\)/);
  assert.match(canvas, /function finishBlockTransform\(runtime,[\s\S]*?releasePointerCapture\(event\.pointerId\)[\s\S]*?runtime\.blockTransform = null/);
  assert.match(canvas, /function cancelBlockEdits\(runtime\)[\s\S]*?runtime\.currentPage\.blocks = cloneBlocks\(runtime\.originalBlocks\)/);
  assert.match(canvas, /pageObjectsModel\.resolveEditableBlockTarget\([\s\S]*?runtime\.canvasObjects,[\s\S]*?runtime\.draftBlocks,[\s\S]*?point/);
});
