(function tabPagePreviewModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.tabPagePreviewModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
  }

  function visibleImageObjects(objects = []) {
    return (Array.isArray(objects) ? objects : []).filter((object) => (
      object
      && object.type === 'image'
      && object.displayable !== false
      && object.visible !== false
      && finite(object.width) > 0
      && finite(object.height) > 0
    ));
  }

  function objectBounds(objects = []) {
    const visible = visibleImageObjects(objects);
    if (!visible.length) return null;
    const minX = Math.min(...visible.map((object) => finite(object.x)));
    const minY = Math.min(...visible.map((object) => finite(object.y)));
    const maxX = Math.max(...visible.map((object) => finite(object.x) + finite(object.width)));
    const maxY = Math.max(...visible.map((object) => finite(object.y) + finite(object.height)));
    return {
      minX,
      minY,
      maxX,
      maxY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY)
    };
  }

  function calculatePreviewSize({
    viewportWidth,
    viewportHeight,
    windowWidth,
    windowHeight,
    minimumWidth = 280,
    maximumWidth = 420,
    sizeScale = 0.75
  } = {}) {
    const viewportW = Math.max(1, finite(viewportWidth, 1));
    const viewportH = Math.max(1, finite(viewportHeight, 1));
    const availableW = Math.max(1, finite(windowWidth, viewportW) - 32);
    const availableH = Math.max(1, finite(windowHeight, viewportH) - 32);
    const preferred = clamp(viewportW * 0.32, minimumWidth, maximumWidth);
    const aspect = viewportH / viewportW;
    const oldWidth = Math.min(preferred, availableW, availableH / aspect);
    const width = oldWidth * clamp(sizeScale, 0.01, 1);
    return {
      width: Math.max(1, width),
      height: Math.max(1, width * aspect)
    };
  }

  function calculateInitialFit(objects, {
    viewportWidth,
    viewportHeight,
    padding = 32,
    minimumScale = 0.1,
    maximumScale = 6
  } = {}) {
    const bounds = objectBounds(objects);
    const width = Math.max(1, finite(viewportWidth, 1));
    const height = Math.max(1, finite(viewportHeight, 1));
    if (!bounds) return { bounds: null, scale: 1, offsetX: 0, offsetY: 0 };
    const usableWidth = Math.max(1, width - Math.max(0, finite(padding)) * 2);
    const usableHeight = Math.max(1, height - Math.max(0, finite(padding)) * 2);
    const scale = clamp(
      Math.min(usableWidth / bounds.width, usableHeight / bounds.height),
      minimumScale,
      maximumScale
    );
    return {
      bounds,
      scale,
      offsetX: (width - bounds.width * scale) / 2 - bounds.minX * scale,
      offsetY: (height - bounds.height * scale) / 2 - bounds.minY * scale
    };
  }

  function previewObjectRects(objects, {
    viewportWidth,
    viewportHeight,
    previewWidth,
    previewHeight,
    padding = 32
  } = {}) {
    const visible = visibleImageObjects(objects);
    const fit = calculateInitialFit(visible, { viewportWidth, viewportHeight, padding });
    const scaleX = Math.max(1, finite(previewWidth, 1)) / Math.max(1, finite(viewportWidth, 1));
    const scaleY = Math.max(1, finite(previewHeight, 1)) / Math.max(1, finite(viewportHeight, 1));
    return visible.map((object) => ({
      object,
      left: (fit.offsetX + finite(object.x) * fit.scale) * scaleX,
      top: (fit.offsetY + finite(object.y) * fit.scale) * scaleY,
      width: finite(object.width) * fit.scale * scaleX,
      height: finite(object.height) * fit.scale * scaleY
    }));
  }

  return {
    calculateInitialFit,
    calculatePreviewSize,
    objectBounds,
    previewObjectRects,
    visibleImageObjects
  };
}));
