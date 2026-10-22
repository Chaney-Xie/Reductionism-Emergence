(function exposeSidebarPageDrag(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.sidebarPageDragModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const DRAG_THRESHOLD = 5;

  function movementExceeded(startX, startY, clientX, clientY, threshold = DRAG_THRESHOLD) {
    return Math.hypot(clientX - startX, clientY - startY) >= threshold;
  }

  function visibleRectWithinClip(rect, clipRect) {
    if (!rect || !clipRect) return rect || null;
    const left = Math.max(Number(rect.left), Number(clipRect.left));
    const right = Math.min(Number(rect.right), Number(clipRect.right));
    const top = Math.max(Number(rect.top), Number(clipRect.top));
    const bottom = Math.min(Number(rect.bottom), Number(clipRect.bottom));
    if (![left, right, top, bottom].every(Number.isFinite)
      || right <= left || bottom <= top) return null;
    return Object.freeze({
      left,
      right,
      top,
      bottom,
      width: right - left,
      height: bottom - top
    });
  }

  function segmentBoundaryCrossings({
    previousX,
    previousY,
    clientX,
    clientY,
    sourceNameRect,
    sidebarLeft = Number.NEGATIVE_INFINITY,
    sidebarRight
  } = {}) {
    const fromX = Number(previousX);
    const fromY = Number(previousY);
    const toX = Number(clientX);
    const toY = Number(clientY);
    const right = Number(sidebarRight);
    if (![fromX, fromY, toX, toY, right].every(Number.isFinite)) {
      return Object.freeze({ first: null, navigation: null, spatial: null });
    }
    const dx = toX - fromX;
    const dy = toY - fromY;
    let spatial = null;
    if (dx > 0 && fromX <= right && toX > right) {
      const t = (right - fromX) / dx;
      if (t >= 0 && t <= 1) {
        spatial = Object.freeze({ kind: 'spatial', t, x: right, y: fromY + (dy * t) });
      }
    }

    const rectTop = Number(sourceNameRect?.top);
    const rectBottom = Number(sourceNameRect?.bottom);
    const left = Number.isFinite(Number(sidebarLeft))
      ? Number(sidebarLeft)
      : Number.NEGATIVE_INFINITY;
    const verticalCandidates = [];
    if (dy < 0 && Number.isFinite(rectTop) && fromY >= rectTop && toY < rectTop) {
      verticalCandidates.push({ edge: 'top', y: rectTop, t: (rectTop - fromY) / dy });
    }
    if (dy > 0 && Number.isFinite(rectBottom) && fromY <= rectBottom && toY > rectBottom) {
      verticalCandidates.push({ edge: 'bottom', y: rectBottom, t: (rectBottom - fromY) / dy });
    }
    const navigationCandidate = verticalCandidates
      .filter(({ t }) => t >= 0 && t <= 1)
      .map(({ edge, y, t }) => ({ edge, y, t, x: fromX + (dx * t) }))
      .filter(({ x }) => x >= left && x <= right)
      .sort((a, b) => a.t - b.t)[0] || null;
    const navigation = navigationCandidate
      ? Object.freeze({ kind: 'navigation', ...navigationCandidate })
      : null;
    const first = spatial && (!navigation || spatial.t < navigation.t)
      ? spatial
      : navigation;
    return Object.freeze({ first, navigation, spatial });
  }

  function boundaryDecisionForSegment(previousDecision, geometry = {}) {
    if (previousDecision === 'navigation' || previousDecision === 'spatial') {
      return previousDecision;
    }
    return segmentBoundaryCrossings(geometry).first?.kind || null;
  }

  function nextPhase(currentPhase, {
    previousX,
    clientX,
    sidebarRight,
    boundaryDecision = null,
    spatialPreviewEligible = true
  } = {}) {
    if (currentPhase === 'navigation-extracted') {
      const liveSidebarRight = Number(sidebarRight);
      return spatialPreviewEligible !== false
        && Number.isFinite(liveSidebarRight)
        && Number(previousX) <= liveSidebarRight
        && Number(clientX) > liveSidebarRight
        ? 'spatial-preview'
        : 'navigation-extracted';
    }
    if (currentPhase !== 'undecided-drag') return currentPhase;
    if (!boundaryDecision) return 'undecided-drag';
    if (boundaryDecision === 'spatial' && spatialPreviewEligible !== false) {
      return 'spatial-preview';
    }
    return 'navigation-extracted';
  }

  function bestReturnRect(sourceRect, sidebarRect) {
    if (!sourceRect || !sidebarRect) return sourceRect || sidebarRect || null;
    const width = Math.max(1, Math.min(sourceRect.width, sidebarRect.width));
    const height = Math.max(1, Math.min(sourceRect.height, sidebarRect.height));
    const left = Math.min(Math.max(sourceRect.left, sidebarRect.left), sidebarRect.right - width);
    const top = Math.min(Math.max(sourceRect.top, sidebarRect.top), sidebarRect.bottom - height);
    return { left, top, width, height, right: left + width, bottom: top + height };
  }

  return Object.freeze({
    DRAG_THRESHOLD,
    bestReturnRect,
    boundaryDecisionForSegment,
    movementExceeded,
    visibleRectWithinClip,
    segmentBoundaryCrossings,
    nextPhase
  });
}));
