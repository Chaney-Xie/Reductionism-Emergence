const test = require('node:test');
const assert = require('node:assert/strict');
const pageObjects = require('../public/pageObjects');

function objects() {
  return [
    { id: 'a', x: 0, y: 0, width: 100, height: 100 },
    { id: 'b', x: 20, y: 20, width: 100, height: 100 },
    { id: 'c', x: 40, y: 40, width: 100, height: 100 }
  ];
}

test('Object order is canonical bottom-to-top and layer commands preserve IDs', () => {
  assert.deepEqual(pageObjects.reorderObjects(objects(), 'b', 'bring-forward').map((item) => item.id), ['a', 'c', 'b']);
  assert.deepEqual(pageObjects.reorderObjects(objects(), 'a', 'bring-to-front').map((item) => item.id), ['b', 'c', 'a']);
  assert.deepEqual(pageObjects.reorderObjects(objects(), 'b', 'send-backward').map((item) => item.id), ['b', 'a', 'c']);
  assert.deepEqual(pageObjects.reorderObjects(objects(), 'c', 'send-to-back').map((item) => item.id), ['c', 'a', 'b']);
});

test('Block order is canonical per Object and reorders without crossing Object layers', () => {
  const blocks = [
    { id: 'a', objectId: 'object_1' },
    { id: 'x', objectId: 'object_2' },
    { id: 'b', objectId: 'object_1' },
    { id: 'c', objectId: 'object_1' }
  ];
  assert.deepEqual(
    pageObjects.reorderBlocks(blocks, 'b', 'bring-forward').map((item) => item.id),
    ['a', 'x', 'c', 'b']
  );
  assert.deepEqual(
    pageObjects.reorderBlocks(blocks, 'b', 'send-backward').map((item) => item.id),
    ['b', 'x', 'a', 'c']
  );
  assert.equal(pageObjects.reorderBlocks(blocks, 'c', 'bring-to-front')[3].id, 'c');
  assert.equal(pageObjects.reorderBlocks(blocks, 'a', 'send-to-back')[0].id, 'a');
});

test('editable Object resolution uses topmost rectangular geometry without image alpha', () => {
  const target = pageObjects.resolveEditableObjectTarget(
    objects(),
    { x: 50, y: 50 }
  );
  assert.equal(target.object.id, 'c');
  assert.deepEqual(target.localPoint, { x: 10, y: 10 });
});

test('ordinary Block resolution checks each layer Block before image alpha occlusion', () => {
  const blocks = [
    { id: 'lower', objectId: 'a', x: 10, y: 10, width: 80, height: 80 },
    { id: 'upper', objectId: 'b', x: 45, y: 45, width: 10, height: 10 }
  ];
  const upperTransparentBlock = pageObjects.resolveOrdinaryBlockTarget(
    objects().slice(0, 2), blocks, { x: 50, y: 50 },
    (object) => object.id !== 'b'
  );
  assert.equal(upperTransparentBlock.object.id, 'b');
  assert.equal(upperTransparentBlock.block.id, 'upper');

  const transparentPassThrough = pageObjects.resolveOrdinaryBlockTarget(
    objects().slice(0, 2), blocks.filter((block) => block.id !== 'upper'), { x: 50, y: 50 },
    (object) => object.id !== 'b'
  );
  assert.equal(transparentPassThrough.object.id, 'a');
  assert.equal(transparentPassThrough.block.id, 'lower');

  const opaqueOcclusion = pageObjects.resolveOrdinaryBlockTarget(
    objects().slice(0, 2), blocks.filter((block) => block.id !== 'upper'), { x: 50, y: 50 }
  );
  assert.equal(opaqueOcclusion.object.id, 'b');
  assert.equal(opaqueOcclusion.block, null, 'an opaque upper image prevents the lower Block');
});

test('ordinary Block resolution skips non-interactive overlapping Blocks', () => {
  const object = { id: 'object', x: 0, y: 0, width: 200, height: 200 };
  const blocks = [
    { id: 'interactive-lower', objectId: 'object', x: 20, y: 20, width: 100, height: 100 },
    { id: 'hidden-upper', objectId: 'object', x: 20, y: 20, width: 100, height: 100 }
  ];
  const target = pageObjects.resolveOrdinaryBlockTarget(
    [object],
    blocks,
    { x: 60, y: 60 },
    () => true,
    (block) => block.id !== 'hidden-upper'
  );
  assert.equal(target.block.id, 'interactive-lower');
});

test('rotated Block hit-testing follows its local rectangle and keeps topmost resolution', () => {
  const object = { id: 'object', x: 0, y: 0, width: 200, height: 200 };
  const blocks = [
    { id: 'lower', objectId: 'object', x: 0, y: 0, width: 160, height: 160, rotation: 0 },
    { id: 'upper', objectId: 'object', x: 50, y: 75, width: 100, height: 20, rotation: 90 }
  ];
  assert.equal(pageObjects.pointInRotatedRect({ x: 100, y: 40 }, blocks[1]), true);
  assert.equal(pageObjects.pointInRotatedRect({ x: 145, y: 85 }, blocks[1]), false);
  assert.equal(pageObjects.findBlockAtPoint(object, blocks, { x: 100, y: 85 }).id, 'upper');
  assert.equal(
    pageObjects.resolveEditableBlockTarget([object], blocks, { x: 100, y: 85 }).block.id,
    'upper'
  );
});

test('rotated Block polygons preserve transformed corners for Highlight mask holes', () => {
  const polygon = pageObjects.rotatedRectPolygon({
    x: 20, y: 40, width: 100, height: 20, rotation: 90
  }).map((point) => ({
    x: Math.round(point.x * 100) / 100,
    y: Math.round(point.y * 100) / 100
  }));
  assert.deepEqual(polygon, [
    { x: 80, y: 0 },
    { x: 80, y: 100 },
    { x: 60, y: 100 },
    { x: 60, y: 0 }
  ]);
});

test('rotated Block edge and corner resizing preserve the opposite anchor and minimum size', () => {
  const start = { id: 'block', x: 0, y: 0, width: 100, height: 50, rotation: 90 };
  const east = pageObjects.resizeRotatedBlock(start, 'e', { x: 50, y: 150 });
  assert.equal(east.rotation, 90);
  assert.equal(east.width, 175);
  assert.equal(Math.round((east.x + east.width / 2) * 100) / 100, 50);
  assert.equal(Math.round((east.y + east.height / 2) * 100) / 100, 62.5);

  const minimum = pageObjects.resizeRotatedBlock(start, 'nw', { x: 75, y: 50 }, 8);
  assert.ok(minimum.width >= 8);
  assert.ok(minimum.height >= 8);
  assert.equal(pageObjects.cloneBlocks([{ ...start, rotation: undefined }])[0].rotation, 0);
});

test('moving and proportional resizing preserve attached Block-relative geometry', () => {
  const start = { id: 'a', x: 10, y: 20, width: 200, height: 100 };
  const block = { id: 'block', objectId: 'a', x: 60, y: 45, width: 50, height: 25, links: [] };
  const moved = pageObjects.transformAttachedBlocks([block], 'a', start, {
    ...start, x: 110, y: 220
  })[0];
  assert.deepEqual({ x: moved.x, y: moved.y, width: moved.width, height: moved.height }, {
    x: 160, y: 245, width: 50, height: 25
  });

  const resized = pageObjects.transformAttachedBlocks([block], 'a', start, {
    x: 10, y: 20, width: 400, height: 200
  })[0];
  assert.deepEqual({ x: resized.x, y: resized.y, width: resized.width, height: resized.height }, {
    x: 110, y: 70, width: 100, height: 50
  });
  const geometry = pageObjects.proportionalGeometry(start, 'se', { x: 410, y: 150 });
  assert.equal(geometry.width / geometry.height, 2);
});
