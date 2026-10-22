(function exposeStructuredTextFrameModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.structuredTextFrameModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const MIN_FRAME_WIDTH = 320;
  const MAX_FRAME_WIDTH = 2400;
  const DEFAULT_TEXT_FRAME = Object.freeze({
    centerWorldX: 0,
    preferredWidth: 760
  });
  const LEGACY_VIEW_FRAME_FIELDS = Object.freeze([
    'markdownFrameOffsetX',
    'markdownFrameWidth',
    'markdownFramePreferredWidth',
    'markdownFrameConstraintSide'
  ]);

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clampFrameWidth(value) {
    return Math.max(MIN_FRAME_WIDTH, Math.min(MAX_FRAME_WIDTH, value));
  }

  function normalizeTextFrame(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const preferredWidth = finiteNumber(
      source.preferredWidth,
      DEFAULT_TEXT_FRAME.preferredWidth
    );
    return {
      centerWorldX: finiteNumber(source.centerWorldX, DEFAULT_TEXT_FRAME.centerWorldX),
      preferredWidth: clampFrameWidth(preferredWidth)
    };
  }

  function validateTextFrame(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'Structured text frame must be an object.' };
    }
    const preferredWidth = Number(value.preferredWidth);
    if (!Number.isFinite(preferredWidth)
      || preferredWidth < MIN_FRAME_WIDTH
      || preferredWidth > MAX_FRAME_WIDTH) {
      return {
        ok: false,
        error: `Structured text width must be between ${MIN_FRAME_WIDTH} and ${MAX_FRAME_WIDTH}.`
      };
    }
    if (Object.hasOwn(value, 'centerWorldX')
      && !Number.isFinite(Number(value.centerWorldX))) {
      return { ok: false, error: 'Structured text frame centre must be a finite number.' };
    }
    return { ok: true, textFrame: normalizeTextFrame(value) };
  }

  function validateTextFramePartial(value, current) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'Structured text frame must be an object.' };
    }
    const baseline = normalizeTextFrame(current);
    const candidate = {
      centerWorldX: Object.hasOwn(value, 'centerWorldX')
        ? value.centerWorldX : baseline.centerWorldX,
      preferredWidth: Object.hasOwn(value, 'preferredWidth')
        ? value.preferredWidth : baseline.preferredWidth
    };
    const validation = validateTextFrame(candidate);
    return validation.ok
      ? { ok: true, value: validation.textFrame, textFrame: validation.textFrame }
      : validation;
  }

  function edgesForFrame(value) {
    const frame = normalizeTextFrame(value);
    const halfWidth = frame.preferredWidth / 2;
    return {
      centerWorldX: frame.centerWorldX,
      preferredWidth: frame.preferredWidth,
      leftWorld: frame.centerWorldX - halfWidth,
      rightWorld: frame.centerWorldX + halfWidth,
      worldWidth: frame.preferredWidth
    };
  }

  function frameFromEdges(leftWorld, rightWorld) {
    const left = Number(leftWorld);
    const right = Number(rightWorld);
    if (!Number.isFinite(left) || !Number.isFinite(right) || right < left) {
      throw new RangeError('Structured text frame edges must be finite and ordered.');
    }
    return normalizeTextFrame({
      centerWorldX: (left + right) / 2,
      preferredWidth: right - left
    });
  }

  function normalizedBoundarySide(value) {
    return value === 'left' || value === 'right' ? value : null;
  }

  function resizeBoundary(value, side, targetWorldX) {
    const boundarySide = normalizedBoundarySide(side);
    const target = Number(targetWorldX);
    if (!boundarySide || !Number.isFinite(target)) return normalizeTextFrame(value);
    const edges = edgesForFrame(value);
    if (boundarySide === 'left') {
      const leftWorld = Math.max(
        edges.rightWorld - MAX_FRAME_WIDTH,
        Math.min(edges.rightWorld - MIN_FRAME_WIDTH, target)
      );
      return frameFromEdges(leftWorld, edges.rightWorld);
    }
    const rightWorld = Math.max(
      edges.leftWorld + MIN_FRAME_WIDTH,
      Math.min(edges.leftWorld + MAX_FRAME_WIDTH, target)
    );
    return frameFromEdges(edges.leftWorld, rightWorld);
  }

  function beginBoundaryDrag(value, side) {
    const boundarySide = normalizedBoundarySide(side);
    if (!boundarySide) throw new TypeError('Structured text boundary must be left or right.');
    const baselineFrame = Object.freeze(normalizeTextFrame(value));
    const edges = edgesForFrame(baselineFrame);
    return Object.freeze({
      side: boundarySide,
      baselineFrame,
      fixedWorldX: boundarySide === 'left' ? edges.rightWorld : edges.leftWorld
    });
  }

  function updateBoundaryDrag(session, targetWorldX) {
    if (!session || normalizedBoundarySide(session.side) === null) {
      throw new TypeError('A structured text boundary-drag session is required.');
    }
    const fixedWorldX = Number(session.fixedWorldX);
    const target = Number(targetWorldX);
    if (!Number.isFinite(fixedWorldX) || !Number.isFinite(target)) {
      return normalizeTextFrame(session.baselineFrame);
    }
    if (session.side === 'left') {
      const leftWorld = Math.max(
        fixedWorldX - MAX_FRAME_WIDTH,
        Math.min(fixedWorldX - MIN_FRAME_WIDTH, target)
      );
      return frameFromEdges(leftWorld, fixedWorldX);
    }
    const rightWorld = Math.max(
      fixedWorldX + MIN_FRAME_WIDTH,
      Math.min(fixedWorldX + MAX_FRAME_WIDTH, target)
    );
    return frameFromEdges(fixedWorldX, rightWorld);
  }

  function projectFrame(value, options = {}) {
    const edges = edgesForFrame(value);
    const cameraX = finiteNumber(options.cameraX, 0);
    const zoom = finiteNumber(options.zoom, 1) > 0 ? finiteNumber(options.zoom, 1) : 1;
    return {
      ...edges,
      zoom,
      cameraX,
      leftScreen: cameraX + edges.leftWorld * zoom,
      rightScreen: cameraX + edges.rightWorld * zoom,
      screenWidth: edges.worldWidth * zoom
    };
  }

  function normalizedInterval(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const left = Number(value.left);
    const right = Number(value.right);
    return Number.isFinite(left) && Number.isFinite(right) && right >= left
      ? { left, right }
      : null;
  }

  function normalizedProjectedFrame(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const left = Number(value.leftScreen ?? value.left);
    const right = Number(value.rightScreen ?? value.right);
    return Number.isFinite(left) && Number.isFinite(right) && right >= left
      ? { left, right }
      : null;
  }

  function viewportResizeResult({ applicable = false, intersectsBefore = false,
    movingEdge = null, direction = null, distance = 0, movingSideAmount = 0,
    oppositeSideAmount = 0, requestedScreenShiftX = 0 } = {}) {
    return Object.freeze({
      applicable,
      intersectsBefore,
      movingEdge,
      direction,
      distance,
      movingSideAmount,
      oppositeSideAmount,
      requestedScreenShiftX
    });
  }

  function resolveViewportResize(options = {}) {
    const oldViewport = normalizedInterval(options.oldViewport);
    const newViewport = normalizedInterval(options.newViewport);
    const frame = normalizedProjectedFrame(options.projectedFrame);
    const movingEdge = normalizedBoundarySide(options.movingEdge);
    if (!oldViewport || !newViewport || !frame || !movingEdge) {
      return viewportResizeResult();
    }
    const horizontalIntersection = Math.min(frame.right, oldViewport.right)
      - Math.max(frame.left, oldViewport.left);
    if (horizontalIntersection <= 0) return viewportResizeResult({ movingEdge });

    if (movingEdge === 'right') {
      const delta = newViewport.right - oldViewport.right;
      if (delta === 0) return viewportResizeResult({ movingEdge, intersectsBefore: true });
      if (delta < 0) {
        const distance = -delta;
        const movingGap = Math.max(0, oldViewport.right - frame.right);
        const consumedMovingGap = Math.min(distance, movingGap);
        const remaining = distance - consumedMovingGap;
        const oppositeGap = Math.max(0, frame.left - oldViewport.left);
        const consumedOppositeGap = Math.min(remaining, oppositeGap);
        return viewportResizeResult({
          applicable: true,
          intersectsBefore: true,
          movingEdge,
          direction: 'shrink',
          distance,
          movingSideAmount: consumedMovingGap,
          oppositeSideAmount: consumedOppositeGap,
          requestedScreenShiftX: consumedOppositeGap ? -consumedOppositeGap : 0
        });
      }
      const distance = delta;
      const movingClip = Math.max(0, frame.right - oldViewport.right);
      const restoredMovingClip = Math.min(distance, movingClip);
      const remaining = distance - restoredMovingClip;
      const oppositeClip = Math.max(0, oldViewport.left - frame.left);
      const restoredOppositeClip = Math.min(remaining, oppositeClip);
      return viewportResizeResult({
        applicable: true,
        intersectsBefore: true,
        movingEdge,
        direction: 'expand',
        distance,
        movingSideAmount: restoredMovingClip,
        oppositeSideAmount: restoredOppositeClip,
        requestedScreenShiftX: restoredOppositeClip
      });
    }

    const delta = newViewport.left - oldViewport.left;
    if (delta === 0) return viewportResizeResult({ movingEdge, intersectsBefore: true });
    if (delta > 0) {
      const distance = delta;
      const movingGap = Math.max(0, frame.left - oldViewport.left);
      const consumedMovingGap = Math.min(distance, movingGap);
      const remaining = distance - consumedMovingGap;
      const oppositeGap = Math.max(0, oldViewport.right - frame.right);
      const consumedOppositeGap = Math.min(remaining, oppositeGap);
      return viewportResizeResult({
        applicable: true,
        intersectsBefore: true,
        movingEdge,
        direction: 'shrink',
        distance,
        movingSideAmount: consumedMovingGap,
        oppositeSideAmount: consumedOppositeGap,
        requestedScreenShiftX: consumedOppositeGap
      });
    }
    const distance = -delta;
    const movingClip = Math.max(0, oldViewport.left - frame.left);
    const restoredMovingClip = Math.min(distance, movingClip);
    const remaining = distance - restoredMovingClip;
    const oppositeClip = Math.max(0, frame.right - oldViewport.right);
    const restoredOppositeClip = Math.min(remaining, oppositeClip);
    return viewportResizeResult({
      applicable: true,
      intersectsBefore: true,
      movingEdge,
      direction: 'expand',
      distance,
      movingSideAmount: restoredMovingClip,
      oppositeSideAmount: restoredOppositeClip,
      requestedScreenShiftX: restoredOppositeClip ? -restoredOppositeClip : 0
    });
  }

  function migrateLegacyFrameViewState(value, canonicalFrame = DEFAULT_TEXT_FRAME) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const migrated = { ...source };
    if (Object.hasOwn(source, 'markdownFrameOffsetX')
      && Number.isFinite(source.markdownFrameOffsetX)) {
      const zoom = Number.isFinite(source.zoom) && source.zoom > 0 ? source.zoom : 1;
      const panX = Number.isFinite(source.panX) ? source.panX : 0;
      const canonicalCenterWorldX = normalizeTextFrame(canonicalFrame).centerWorldX;
      migrated.panX = panX
        + (source.markdownFrameOffsetX - canonicalCenterWorldX) * zoom;
    }
    for (const field of LEGACY_VIEW_FRAME_FIELDS) delete migrated[field];
    return migrated;
  }

  return Object.freeze({
    DEFAULT_TEXT_FRAME,
    LEGACY_VIEW_FRAME_FIELDS,
    MIN_FRAME_WIDTH,
    MAX_FRAME_WIDTH,
    normalizeTextFrame,
    validateTextFrame,
    validateTextFramePartial,
    edgesForFrame,
    frameFromEdges,
    resizeBoundary,
    beginBoundaryDrag,
    updateBoundaryDrag,
    projectFrame,
    resolveViewportResize,
    migrateLegacyFrameViewState
  });
}));
