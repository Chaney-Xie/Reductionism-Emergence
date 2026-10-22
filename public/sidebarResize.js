(function exposeSidebarResize(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.sidebarResizeModel = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const DEFAULT_EXPANDED_WIDTH = 220;
  const MIN_EXPANDED_WIDTH = DEFAULT_EXPANDED_WIDTH;
  const MIN_CANVAS_WIDTH = 320;
  const EDGE_COLLAPSE_THRESHOLD = 28;

  function finiteWidth(value, fallback = DEFAULT_EXPANDED_WIDTH) {
    const width = Number(value);
    return Number.isFinite(width) ? width : fallback;
  }

  function maximumExpandedWidth(viewportWidth, otherSidebarWidth = 0) {
    const available = finiteWidth(viewportWidth, MIN_EXPANDED_WIDTH)
      - Math.max(0, finiteWidth(otherSidebarWidth, 0))
      - MIN_CANVAS_WIDTH;
    return Math.max(MIN_EXPANDED_WIDTH, available);
  }

  function clampExpandedWidth(value, { viewportWidth, otherSidebarWidth = 0 } = {}) {
    const maximum = maximumExpandedWidth(viewportWidth, otherSidebarWidth);
    return Math.min(maximum, Math.max(MIN_EXPANDED_WIDTH, finiteWidth(value)));
  }

  function pointerWidth(side, clientX, viewportWidth) {
    return side === 'right' ? viewportWidth - clientX : clientX;
  }

  function pointerReachedOuterEdge(side, clientX, viewportWidth) {
    return side === 'right'
      ? clientX >= viewportWidth - EDGE_COLLAPSE_THRESHOLD
      : clientX <= EDGE_COLLAPSE_THRESHOLD;
  }

  return {
    DEFAULT_EXPANDED_WIDTH,
    EDGE_COLLAPSE_THRESHOLD,
    MIN_CANVAS_WIDTH,
    MIN_EXPANDED_WIDTH,
    clampExpandedWidth,
    maximumExpandedWidth,
    pointerReachedOuterEdge,
    pointerWidth
  };
}));
