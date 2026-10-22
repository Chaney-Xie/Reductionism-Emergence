(function exposePageObjectsModel(globalObject) {
  const MIN_OBJECT_SIZE = 48;

  function cloneObjects(objects = []) {
    return objects.map((object) => ({ ...object }));
  }

  function cloneBlocks(blocks = []) {
    return blocks.map((block) => ({
      ...block,
      rotation: Number.isFinite(block.rotation) ? block.rotation : 0,
      links: (block.links || []).map((link) => ({ ...link }))
    }));
  }

  function pointInRect(point, rect) {
    return point.x >= rect.x && point.y >= rect.y
      && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height;
  }

  function normalizedRotation(value) {
    if (!Number.isFinite(value)) return 0;
    const rotation = value % 360;
    return rotation < -180 ? rotation + 360 : rotation >= 180 ? rotation - 360 : rotation;
  }

  function pointInRotatedRect(point, rect) {
    const centreX = rect.x + rect.width / 2;
    const centreY = rect.y + rect.height / 2;
    const radians = -normalizedRotation(rect.rotation) * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const deltaX = point.x - centreX;
    const deltaY = point.y - centreY;
    const localX = deltaX * cosine - deltaY * sine;
    const localY = deltaX * sine + deltaY * cosine;
    return Math.abs(localX) <= rect.width / 2 && Math.abs(localY) <= rect.height / 2;
  }

  function rotatedRectPolygon(rect) {
    const centreX = rect.x + rect.width / 2;
    const centreY = rect.y + rect.height / 2;
    const radians = normalizedRotation(rect.rotation) * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const cleanCoordinate = (value) => Math.abs(value) < 1e-10 ? 0 : value;
    return [
      { x: -rect.width / 2, y: -rect.height / 2 },
      { x: rect.width / 2, y: -rect.height / 2 },
      { x: rect.width / 2, y: rect.height / 2 },
      { x: -rect.width / 2, y: rect.height / 2 }
    ].map((point) => ({
      x: cleanCoordinate(centreX + point.x * cosine - point.y * sine),
      y: cleanCoordinate(centreY + point.x * sine + point.y * cosine)
    }));
  }

  function findBlockAtPoint(object, blocks, point, acceptsBlock = () => true) {
    const objectBlocks = blocks.filter((block) => (
      block.objectId === object.id && acceptsBlock(block)
    ));
    return [...objectBlocks].reverse().find((block) => pointInRotatedRect(point, block)) || null;
  }

  function resolveEditableBlockTarget(objects, blocks, point) {
    for (let index = objects.length - 1; index >= 0; index -= 1) {
      const object = objects[index];
      if (!pointInRect(point, object)) continue;
      const localPoint = { x: point.x - object.x, y: point.y - object.y };
      return { object, block: findBlockAtPoint(object, blocks, point), localPoint };
    }
    return { object: null, block: null, localPoint: null };
  }

  function resolveEditableObjectTarget(objects, point) {
    for (let index = objects.length - 1; index >= 0; index -= 1) {
      const object = objects[index];
      if (!pointInRect(point, object)) continue;
      const localPoint = { x: point.x - object.x, y: point.y - object.y };
      return { object, block: null, localPoint };
    }
    return { object: null, block: null, localPoint: null };
  }

  function resolveOrdinaryBlockTarget(
    objects,
    blocks,
    point,
    imageOccupiesPoint = () => true,
    acceptsBlock = () => true
  ) {
    for (let index = objects.length - 1; index >= 0; index -= 1) {
      const object = objects[index];
      if (!pointInRect(point, object)) continue;
      const localPoint = { x: point.x - object.x, y: point.y - object.y };
      const block = findBlockAtPoint(object, blocks, point, acceptsBlock);
      if (block) return { object, block, localPoint };
      if (imageOccupiesPoint(object, localPoint)) return { object, block: null, localPoint };
    }
    return { object: null, block: null, localPoint: null };
  }

  function reorderObjects(objects, objectId, command) {
    const next = [...objects];
    const index = next.findIndex((object) => object.id === objectId);
    if (index < 0) return next;
    const last = next.length - 1;
    let destination = index;
    if (command === 'bring-forward') destination = Math.min(last, index + 1);
    if (command === 'bring-to-front') destination = last;
    if (command === 'send-backward') destination = Math.max(0, index - 1);
    if (command === 'send-to-back') destination = 0;
    if (destination === index) return next;
    const [object] = next.splice(index, 1);
    next.splice(destination, 0, object);
    return next;
  }

  function reorderBlocks(blocks, blockId, command) {
    const block = blocks.find((item) => item.id === blockId);
    if (!block) return [...blocks];
    const positions = [];
    const ordered = [];
    blocks.forEach((item, index) => {
      if (item.objectId !== block.objectId) return;
      positions.push(index);
      ordered.push(item);
    });
    const index = ordered.findIndex((item) => item.id === blockId);
    if (index < 0) return [...blocks];
    const last = ordered.length - 1;
    let destination = index;
    if (command === 'bring-forward') destination = Math.min(last, index + 1);
    if (command === 'bring-to-front') destination = last;
    if (command === 'send-backward') destination = Math.max(0, index - 1);
    if (command === 'send-to-back') destination = 0;
    if (destination === index) return [...blocks];
    const [moved] = ordered.splice(index, 1);
    ordered.splice(destination, 0, moved);
    const next = [...blocks];
    positions.forEach((position, orderedIndex) => {
      next[position] = ordered[orderedIndex];
    });
    return next;
  }

  function resizeRotatedBlock(start, handle, point, minimum = 8) {
    const rotation = normalizedRotation(start.rotation);
    const radians = rotation * Math.PI / 180;
    const axisX = { x: Math.cos(radians), y: Math.sin(radians) };
    const axisY = { x: -Math.sin(radians), y: Math.cos(radians) };
    const centre = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
    const usesX = handle.includes('e') || handle.includes('w');
    const usesY = handle.includes('n') || handle.includes('s');
    const directionX = handle.includes('w') ? -1 : 1;
    const directionY = handle.includes('n') ? -1 : 1;
    const fixed = {
      x: centre.x
        - (usesX ? axisX.x * directionX * start.width / 2 : 0)
        - (usesY ? axisY.x * directionY * start.height / 2 : 0),
      y: centre.y
        - (usesX ? axisX.y * directionX * start.width / 2 : 0)
        - (usesY ? axisY.y * directionY * start.height / 2 : 0)
    };
    const delta = { x: point.x - fixed.x, y: point.y - fixed.y };
    const width = usesX
      ? Math.max(minimum, directionX * (delta.x * axisX.x + delta.y * axisX.y))
      : start.width;
    const height = usesY
      ? Math.max(minimum, directionY * (delta.x * axisY.x + delta.y * axisY.y))
      : start.height;
    const nextCentre = {
      x: fixed.x
        + (usesX ? axisX.x * directionX * width / 2 : 0)
        + (usesY ? axisY.x * directionY * height / 2 : 0),
      y: fixed.y
        + (usesX ? axisX.y * directionX * width / 2 : 0)
        + (usesY ? axisY.y * directionY * height / 2 : 0)
    };
    return {
      ...start,
      x: nextCentre.x - width / 2,
      y: nextCentre.y - height / 2,
      width,
      height,
      rotation
    };
  }

  function transformAttachedBlocks(blocks, objectId, from, to) {
    const scaleX = to.width / from.width;
    const scaleY = to.height / from.height;
    return blocks.map((block) => block.objectId !== objectId ? block : ({
      ...block,
      x: to.x + (block.x - from.x) * scaleX,
      y: to.y + (block.y - from.y) * scaleY,
      width: block.width * scaleX,
      height: block.height * scaleY
    }));
  }

  function proportionalGeometry(start, handle, point, minimum = MIN_OBJECT_SIZE) {
    const aspect = start.width / start.height;
    const fromLeft = handle.includes('w');
    const fromTop = handle.includes('n');
    const anchorX = fromLeft ? start.x + start.width : start.x;
    const anchorY = fromTop ? start.y + start.height : start.y;
    const rawWidth = Math.abs(point.x - anchorX);
    const rawHeight = Math.abs(point.y - anchorY);
    const width = Math.max(minimum, rawWidth, rawHeight * aspect);
    const height = width / aspect;
    return {
      x: fromLeft ? anchorX - width : anchorX,
      y: fromTop ? anchorY - height : anchorY,
      width,
      height
    };
  }

  const api = Object.freeze({
    MIN_OBJECT_SIZE,
    cloneObjects,
    cloneBlocks,
    normalizedRotation,
    pointInRect,
    pointInRotatedRect,
    rotatedRectPolygon,
    findBlockAtPoint,
    proportionalGeometry,
    reorderBlocks,
    reorderObjects,
    resizeRotatedBlock,
    resolveEditableBlockTarget,
    resolveEditableObjectTarget,
    resolveOrdinaryBlockTarget,
    transformAttachedBlocks
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalObject) globalObject.pageObjectsModel = api;
})(typeof window === 'undefined' ? globalThis : window);
