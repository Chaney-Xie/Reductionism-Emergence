/* Canvas viewport/world transforms, visual objects, and block edit lifecycle.
 * Every mutable presentation/edit field belongs to the explicit Pane runtime.
 */
const structuredTextViewportStates = new WeakMap();
const liveStructuredTextViewportStates = new Set();
let structuredTextViewportMoveFrame = null;

const STRUCTURED_TEXT_VIEWPORT_EDGE_EPSILON = 0.5;
const STRUCTURED_TEXT_WINDOW_MOVE_CONFIRMATION_FRAMES = 3;

const QUICK_COLOUR_VIEWPORT_PADDING = 8;
const QUICK_COLOUR_TARGET_GAP = 8;
const QUICK_COLOUR_DRAG_THRESHOLD = 4;
const BLOCK_COLOURFUL_STYLE_NAMES = Object.freeze(
  [1, 2, 3].flatMap((status) => [
    `--block-colourful-status-${status}-fill-colour`,
    `--block-colourful-status-${status}-border-colour`
  ])
);

function isVisibleObject(object) {
  return object.visible !== false;
}

function isDisplayableObject(object) {
  const location = resourceLocationsModel.tryNormalizeResourceLocation(object);
  return object.displayable !== false
    && object.type === 'image'
    && Boolean(object.src || location);
}

const CANVAS_IMAGE_RESOLUTION_DEBOUNCE_MS = 150;

function desktopDisplayProxiesAvailable() {
  return typeof globalThis.cneDesktop?.requestDisplayProxy === 'function';
}

function desktopManagedResourceResolverAvailable() {
  return typeof globalThis.cneDesktop?.resolveManagedResource === 'function';
}

function canvasImageTierRank(tier) {
  return imageResolutionModel.tierRank(tier);
}

function resetCanvasImageSession(runtime, pageId) {
  if (runtime.canvasImageSessionPageId === pageId) return;
  runtime.canvasImageSessionPageId = pageId || null;
  runtime.canvasImageSessionGeneration += 1;
  clearTimeout(runtime.canvasImageResolutionTimer);
  runtime.canvasImageResolutionTimer = null;
  runtime.canvasImageVariantStates.clear();
}

function canvasImageState(runtime, object) {
  let state = runtime.canvasImageVariantStates.get(object.id);
  if (!state) {
    state = {
      objectId: object.id,
      fingerprint: null,
      currentTier: null,
      pendingTier: null,
      displayUrl: null,
      requestInFlight: false,
      imageElement: null,
      slotElement: null,
      decodeTier: null,
      lastRequiredLongEdge: null,
      earlyReady: [],
      alphaMask: null,
      alphaMaskFingerprint: null,
      alphaMaskPending: false,
      layerElement: null
    };
    runtime.canvasImageVariantStates.set(object.id, state);
  }
  return state;
}

function configureCanvasImageElement(image, object) {
  image.className = 'canvas-object-image';
  image.dataset.objectId = object.id;
  image.alt = '';
  image.draggable = false;
  image.style.left = '0';
  image.style.top = '0';
  image.style.width = '100%';
  image.style.height = '100%';
}

function objectMayHaveAlpha(object) {
  const value = `${object.mimeType || ''} ${object.resourceType || ''} ${object.originalName || object.src || ''}`
    .toLowerCase();
  return /(?:image\/png|image\/webp|image\/gif|image\/svg\+xml|\.png\b|\.webp\b|\.gif\b|\.svg\b)/.test(value);
}

function buildCanvasAlphaMask(object, state, image, fingerprint) {
  if (!objectMayHaveAlpha(object)) {
    state.alphaMask = null;
    state.alphaMaskFingerprint = fingerprint;
    state.alphaMaskPending = false;
    return;
  }
  if (state.alphaMaskFingerprint === fingerprint && (state.alphaMask || state.alphaMaskPending)) return;
  state.alphaMask = null;
  state.alphaMaskFingerprint = fingerprint;
  state.alphaMaskPending = true;
  try {
    const maxEdge = 256;
    const naturalWidth = Math.max(1, image.naturalWidth || object.naturalWidth || object.width);
    const naturalHeight = Math.max(1, image.naturalHeight || object.naturalHeight || object.height);
    const scale = Math.min(1, maxEdge / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const context = maskCanvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const alpha = new Uint8Array(width * height);
    for (let index = 0; index < alpha.length; index += 1) alpha[index] = pixels[index * 4 + 3];
    if (state.alphaMaskFingerprint !== fingerprint) return;
    state.alphaMask = { width, height, alpha };
  } catch {
    // A pending/failed mask deliberately remains opaque to prevent lower-layer leaks.
    state.alphaMask = null;
  } finally {
    if (state.alphaMaskFingerprint === fingerprint) state.alphaMaskPending = false;
  }
}

function canvasObjectOpaqueAt(runtime, object, localPoint) {
  if (!objectMayHaveAlpha(object)) return true;
  const state = runtime.canvasImageVariantStates.get(object.id);
  const mask = state?.alphaMask;
  if (!mask || state.alphaMaskPending) return true;
  const x = Math.min(mask.width - 1, Math.max(0, Math.floor(localPoint.x / object.width * mask.width)));
  const y = Math.min(mask.height - 1, Math.max(0, Math.floor(localPoint.y / object.height * mask.height)));
  return mask.alpha[y * mask.width + x] >= 8;
}

function setCanvasImageMissing(state, missing) {
  if (!state) return;
  if (missing && !state.currentTier) {
    if (state.imageElement) state.imageElement.hidden = true;
  } else if (!missing) {
    if (state.imageElement) state.imageElement.hidden = false;
  }
}

function invalidateCanvasImageSource(state) {
  if (!state) return;
  state.fingerprint = null;
  state.currentTier = null;
  state.pendingTier = null;
  state.displayUrl = null;
  state.decodeTier = null;
  state.alphaMask = null;
  state.alphaMaskFingerprint = null;
  state.alphaMaskPending = false;
  if (state.imageElement) {
    state.imageElement.hidden = true;
    state.imageElement.removeAttribute('src');
  }
}

async function decodeCanvasVariant(runtime, object, state, fingerprint, variant, operation) {
  if (!variant?.displayUrl || !variant.tier) return false;
  const nextRank = canvasImageTierRank(variant.tier);
  const currentTierIsVisible = Boolean(
    state.imageElement?.isConnected
    && !state.imageElement.hidden
    && state.imageElement.hasAttribute('src')
  );
  if (nextRank < canvasImageTierRank(state.currentTier)
    || (nextRank === canvasImageTierRank(state.currentTier)
      && state.displayUrl === variant.displayUrl && currentTierIsVisible)
    || state.decodeTier === variant.tier) return false;

  state.decodeTier = variant.tier;
  const candidate = document.createElement('img');
  configureCanvasImageElement(candidate, object);
  candidate.hidden = true;
  candidate.src = variant.displayUrl;
  try {
    if (typeof candidate.decode === 'function') await candidate.decode();
    else await new Promise((resolve, reject) => {
      candidate.addEventListener('load', resolve, { once: true });
      candidate.addEventListener('error', reject, { once: true });
    });
  } catch {
    if (state.decodeTier === variant.tier) state.decodeTier = null;
    if (canvasImageTierRank(variant.tier) >= canvasImageTierRank(state.pendingTier)) {
      state.pendingTier = null;
    }
    setCanvasImageMissing(state, true);
    return false;
  }

  const currentObject = runtime.canvasObjects.find((item) => item.id === object.id);
  if (!runtimeOperationIsCurrent(operation)
    || operation.generation !== runtime.canvasImageSessionGeneration
    || runtime.currentPage?.id !== runtime.canvasImageSessionPageId
    || !currentObject
    || runtime.canvasImageVariantStates.get(object.id) !== state
    || state.fingerprint !== fingerprint
    || nextRank < canvasImageTierRank(state.currentTier)) return false;

  candidate.hidden = false;
  const previous = state.imageElement;
  if (previous?.isConnected) previous.replaceWith(candidate);
  else if (state.layerElement?.isConnected) {
    state.layerElement.append(candidate);
  } else return false;
  state.imageElement = candidate;
  state.currentTier = variant.tier;
  state.displayUrl = variant.displayUrl;
  state.decodeTier = null;
  if (canvasImageTierRank(variant.tier) >= canvasImageTierRank(state.pendingTier)) {
    state.pendingTier = null;
  }
  setCanvasImageMissing(state, false);
  buildCanvasAlphaMask(object, state, candidate, fingerprint);
  return true;
}

function acceptCanvasProxyResponse(runtime, object, state, response, operation) {
  if (!response?.ok || !runtimeOperationIsCurrent(operation)
    || operation.generation !== runtime.canvasImageSessionGeneration
    || runtime.currentPage?.id !== runtime.canvasImageSessionPageId
    || !runtime.canvasObjects.some((item) => item.id === object.id)) {
    if (!response?.ok && ['SOURCE_MISSING', 'RESOURCE_NOT_FOUND'].includes(response?.code)) {
      invalidateCanvasImageSource(state);
    } else if (!response?.ok) setCanvasImageMissing(state, true);
    return;
  }
  if (response.relocation
    && typeof applyManagedResourceRelocationToCurrentPage === 'function') {
    applyManagedResourceRelocationToCurrentPage(runtime, response.relocation);
  }
  if (state.fingerprint && state.fingerprint !== response.fingerprint) {
    invalidateCanvasImageSource(state);
  }
  state.fingerprint = response.fingerprint;
  state.pendingTier = response.generationPending ? response.requestedTier : null;
  if (response.variant) {
    decodeCanvasVariant(runtime, object, state, response.fingerprint, response.variant, operation);
  }
  for (const ready of state.earlyReady.splice(0)) {
    if (ready.fingerprint === state.fingerprint) handleCanvasDisplayProxyReady(runtime, ready);
  }
}

async function requestCanvasImageResolution(runtime, object, requiredLongEdge, {
  validateSource = false
} = {}) {
  const state = canvasImageState(runtime, object);
  state.lastRequiredLongEdge = requiredLongEdge;
  if (state.requestInFlight) return;
  const requiredTier = imageResolutionModel.chooseTier(
    object.naturalWidth || object.width,
    object.naturalHeight || object.height,
    requiredLongEdge
  );
  if (!validateSource && canvasImageTierRank(requiredTier) <= Math.max(
    canvasImageTierRank(state.currentTier),
    canvasImageTierRank(state.pendingTier),
    canvasImageTierRank(state.decodeTier)
  )) return;

  const generation = runtime.canvasImageSessionGeneration;
  const operation = captureRuntimeOperation(runtime, {
    scope: 'canvas-image-resolution',
    pageId: runtime.currentPage?.id || null,
    generation,
    objectId: object.id
  });
  state.requestInFlight = true;
  try {
    if (desktopManagedResourceResolverAvailable()) {
      const location = resourceLocationsModel.tryNormalizeResourceLocation(object);
      const resolution = await globalThis.cneDesktop.resolveManagedResource({
        pageId: operation.pageId,
        resourceId: object.id,
        location
      });
      if (!runtimeOperationIsCurrent(operation)
        || generation !== runtime.canvasImageSessionGeneration
        || runtime.currentPage?.id !== runtime.canvasImageSessionPageId) return;
      if (!resolution?.ok) {
        if (['SOURCE_MISSING', 'RESOURCE_NOT_FOUND'].includes(resolution?.code)) {
          invalidateCanvasImageSource(state);
        } else {
          setCanvasImageMissing(state, true);
        }
        return;
      }
      if (resolution.relocated
        && typeof applyManagedResourceRelocationToCurrentPage === 'function') {
        applyManagedResourceRelocationToCurrentPage(runtime, resolution);
      }
    }
    const response = await globalThis.cneDesktop.requestDisplayProxy({
      pageId: operation.pageId,
      objectId: object.id,
      requiredLongEdge
    });
    acceptCanvasProxyResponse(runtime, object, state, response, operation);
  } catch {
    setCanvasImageMissing(state, true);
  } finally {
    if (runtime.canvasImageVariantStates.get(object.id) === state) {
      state.requestInFlight = false;
    }
  }
}

function checkCanvasImageResolutions(runtime, { validateSource = false } = {}) {
  runtime.canvasImageResolutionTimer = null;
  if (!runtimeIsLive(runtime) || !desktopDisplayProxiesAvailable()
    || !runtime.currentPage || !runtime.canvasObjects.length) return;
  for (const object of runtime.canvasObjects) {
    requestCanvasImageResolution(
      runtime,
      object,
      imageResolutionModel.requiredLongEdge(
        object,
        runtime.canvasView.scale,
        globalThis.devicePixelRatio
      ),
      { validateSource }
    );
  }
}

function scheduleCanvasImageResolutionCheck(
  runtime,
  delay = CANVAS_IMAGE_RESOLUTION_DEBOUNCE_MS
) {
  if (!desktopDisplayProxiesAvailable()) return;
  clearTimeout(runtime.canvasImageResolutionTimer);
  runtime.canvasImageResolutionTimer = setTimeout(
    () => checkCanvasImageResolutions(runtime),
    delay
  );
}

function handleCanvasDisplayProxyReady(runtime, payload) {
  if (!runtimeIsLive(runtime) || !payload || payload.pageId !== runtime.currentPage?.id
    || payload.pageId !== runtime.canvasImageSessionPageId) return;
  const object = runtime.canvasObjects.find((item) => item.id === payload.objectId);
  const state = object && runtime.canvasImageVariantStates.get(payload.objectId);
  if (!object || !state) return;
  if (!state.fingerprint) {
    state.earlyReady.push(payload);
    return;
  }
  if (state.fingerprint !== payload.fingerprint) return;
  if (canvasImageTierRank(payload.variant?.tier) <= canvasImageTierRank(state.currentTier)) return;
  decodeCanvasVariant(
    runtime,
    object,
    state,
    payload.fingerprint,
    payload.variant,
    captureRuntimeOperation(runtime, {
      scope: 'canvas-image-decode',
      pageId: payload.pageId,
      generation: runtime.canvasImageSessionGeneration,
      objectId: payload.objectId
    })
  );
}

function initializeCanvasImageResolution() {
  canvasImageProxyUnsubscribe?.();
  canvasImageProxyUnsubscribe = globalThis.cneDesktop?.onDisplayProxyReady?.(
    (payload) => {
      for (const runtime of livingPaneRuntimes()) {
        handleCanvasDisplayProxyReady(runtime, payload);
      }
    }
  ) || null;
  globalThis.addEventListener?.('resize', () => {
    for (const runtime of livingPaneRuntimes()) {
      scheduleCanvasImageResolutionCheck(runtime);
    }
  });
}

function clampCanvasScale(scale) {
  return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, scale));
}

function getObjectBounds(objects) {
  const minX = Math.min(...objects.map((object) => object.x));
  const minY = Math.min(...objects.map((object) => object.y));
  const maxX = Math.max(...objects.map((object) => object.x + object.width));
  const maxY = Math.max(...objects.map((object) => object.y + object.height));
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function writeCanvasTransformFor(stage, area, view) {
  stage.style.transform = `translate(${view.offsetX}px, ${view.offsetY}px) scale(${view.scale})`;
  area.dataset.scale = String(view.scale);
  area.dataset.offsetX = String(view.offsetX);
  area.dataset.offsetY = String(view.offsetY);
  if (typeof updateMarkdownPageLayer === 'function') {
    updateMarkdownPageLayer(stage, {
      zoom: view.scale,
      cameraOffsetX: view.offsetX,
      cameraOffsetY: view.offsetY
    });
  }
  if (typeof updateHnTextPageLayer === 'function') {
    updateHnTextPageLayer(stage, {
      zoom: view.scale,
      cameraOffsetX: view.offsetX,
      cameraOffsetY: view.offsetY
    });
  }
}

function structuredTextViewportRect(area) {
  const rect = area?.getBoundingClientRect?.();
  if (!rect) return null;
  const windowScreenX = Number(globalThis.screenX);
  const screenX = Number.isFinite(windowScreenX) ? windowScreenX : 0;
  const localLeft = Number(rect.left);
  const clientWidth = Number(area.clientWidth);
  const width = Number.isFinite(clientWidth) && clientWidth >= 0
    ? clientWidth
    : Number(rect.width);
  const localRight = localLeft + width;
  const left = screenX + localLeft;
  const right = left + width;
  const windowOuterWidthValue = Number(globalThis.outerWidth);
  const windowInnerWidthValue = Number(globalThis.innerWidth);
  const windowOuterWidth = Number.isFinite(windowOuterWidthValue)
    ? windowOuterWidthValue
    : null;
  const windowInnerWidth = Number.isFinite(windowInnerWidthValue)
    ? windowInnerWidthValue
    : null;
  if (!Number.isFinite(localLeft) || !Number.isFinite(localRight)
    || !Number.isFinite(left) || !Number.isFinite(right) || right < left) return null;
  return {
    left,
    right,
    localLeft,
    localRight,
    screenX,
    windowOuterWidth,
    windowInnerWidth
  };
}

function structuredTextViewportValueUnchanged(oldValue, newValue) {
  return Number.isFinite(oldValue) && Number.isFinite(newValue)
    && Math.abs(newValue - oldValue) <= STRUCTURED_TEXT_VIEWPORT_EDGE_EPSILON;
}

function structuredTextViewportLocalGeometryUnchanged(oldViewport, newViewport) {
  return structuredTextViewportValueUnchanged(
    oldViewport?.localLeft,
    newViewport?.localLeft
  ) && structuredTextViewportValueUnchanged(
    oldViewport?.localRight,
    newViewport?.localRight
  );
}

function structuredTextViewportWindowSizeUnchanged(oldViewport, newViewport) {
  return structuredTextViewportValueUnchanged(
    oldViewport?.windowOuterWidth,
    newViewport?.windowOuterWidth
  ) && structuredTextViewportValueUnchanged(
    oldViewport?.windowInnerWidth,
    newViewport?.windowInnerWidth
  );
}

function structuredTextViewportMoveCandidateUnchanged(candidate, nextViewport) {
  return structuredTextViewportValueUnchanged(candidate?.screenX, nextViewport?.screenX)
    && structuredTextViewportLocalGeometryUnchanged(candidate, nextViewport)
    && structuredTextViewportWindowSizeUnchanged(candidate, nextViewport);
}

function structuredTextViewportMovingEdge(oldViewport, newViewport) {
  if (!oldViewport || !newViewport) return null;
  const oldWidth = oldViewport.right - oldViewport.left;
  const newWidth = newViewport.right - newViewport.left;
  if (Math.abs(newWidth - oldWidth) <= STRUCTURED_TEXT_VIEWPORT_EDGE_EPSILON) return null;
  const leftMoved = Math.abs(newViewport.left - oldViewport.left)
    > STRUCTURED_TEXT_VIEWPORT_EDGE_EPSILON;
  const rightMoved = Math.abs(newViewport.right - oldViewport.right)
    > STRUCTURED_TEXT_VIEWPORT_EDGE_EPSILON;
  if (leftMoved === rightMoved) return null;
  return leftMoved ? 'left' : 'right';
}

function saveStructuredTextCameraForRuntime(runtime, tab, pageId, view) {
  const activeTab = runtime?.session?.activeTab?.();
  if (!tab || activeTab?.id !== tab.id || activeTab.currentPageId !== pageId
    || !view) return false;
  runtime.session.saveViewState(tab.id, {
    ...tab.viewState,
    panX: view.offsetX,
    panY: view.offsetY,
    zoom: view.scale,
    viewportInitialized: true
  });
  if (typeof scheduleWorkspaceStateSave === 'function') scheduleWorkspaceStateSave();
  return true;
}

function applyStructuredTextViewportResize(runtime, state, nextViewport) {
  const model = globalThis.structuredTextFrameModel;
  const oldViewport = state?.viewport;
  if (state) state.pendingWindowMove = null;
  const movingEdge = structuredTextViewportMovingEdge(oldViewport, nextViewport);
  state.viewport = nextViewport;
  if (!model || !oldViewport || !nextViewport || !movingEdge) return false;

  const tab = runtime?.session?.activeTab?.();
  const view = runtime?.canvasView;
  const page = runtime?.currentPage;
  if (!runtimeIsLive(runtime) || !runtimeOperationIsCurrent(state.operation)
    || !tab || tab.id !== state.tabId || tab.currentPageId !== state.pageId
    || !view || page?.id !== state.pageId) return false;
  const frame = runtime.pageEditMode && runtime.draftPageTextFrame
    ? runtime.draftPageTextFrame
    : page.textFrame;
  const projectedFrame = model.projectFrame(frame, {
    cameraX: oldViewport.left + view.offsetX,
    zoom: view.scale
  });
  const resolution = model.resolveViewportResize({
    oldViewport,
    newViewport: nextViewport,
    projectedFrame,
    movingEdge
  });
  if (!resolution?.applicable) return false;

  // Camera offsets are Pane-local screen pixels. When the left viewport edge
  // is the one moving, first counter its screen-origin delta, then apply the
  // model's incremental shift. A right-edge resize has no origin component.
  const originCompensation = movingEdge === 'left'
    ? oldViewport.left - nextViewport.left
    : 0;
  const deltaX = originCompensation + Number(resolution.requestedScreenShiftX || 0);
  if (Math.abs(deltaX) <= Number.EPSILON) return true;
  view.offsetX += deltaX;
  writeCanvasTransformFor(state.stage, state.area, view);
  saveStructuredTextCameraForRuntime(runtime, tab, state.pageId, view);
  return true;
}

function synchronizeStructuredTextViewportWindowPosition() {
  structuredTextViewportMoveFrame = null;
  for (const state of liveStructuredTextViewportStates) {
    const runtime = state.runtime;
    if (!runtimeIsLive(runtime) || !runtimeOperationIsCurrent(state.operation)
      || !state.area?.isConnected) {
      disconnectStructuredTextViewport(runtime, state.area);
      continue;
    }
    const oldViewport = state.viewport;
    const nextViewport = structuredTextViewportRect(state.area);
    if (!oldViewport || !nextViewport
      || structuredTextViewportValueUnchanged(nextViewport.screenX, oldViewport.screenX)) {
      state.pendingWindowMove = null;
      continue;
    }
    const localGeometryUnchanged = structuredTextViewportLocalGeometryUnchanged(
      oldViewport,
      nextViewport
    );
    const windowSizeUnchanged = structuredTextViewportWindowSizeUnchanged(
      oldViewport,
      nextViewport
    );
    // A size-preserving native-window move has no camera semantics. Rebase the
    // absolute screen-space snapshot only after both browser width metrics and
    // Pane-local geometry remain stable for consecutive animation frames. A
    // ResizeObserver delivery cancels this candidate before edge classification,
    // so split screen-position/width delivery cannot masquerade as a pure move.
    if (!localGeometryUnchanged || !windowSizeUnchanged) {
      state.pendingWindowMove = null;
      continue;
    }
    const pending = state.pendingWindowMove;
    if (!pending || !structuredTextViewportMoveCandidateUnchanged(
      pending.viewport,
      nextViewport
    )) {
      state.pendingWindowMove = { viewport: nextViewport, stableFrames: 1 };
      continue;
    }
    pending.viewport = nextViewport;
    pending.stableFrames += 1;
    if (pending.stableFrames >= STRUCTURED_TEXT_WINDOW_MOVE_CONFIRMATION_FRAMES) {
      state.viewport = nextViewport;
      state.pendingWindowMove = null;
    }
  }
  if (liveStructuredTextViewportStates.size
    && typeof globalThis.requestAnimationFrame === 'function') {
    structuredTextViewportMoveFrame = globalThis.requestAnimationFrame(
      synchronizeStructuredTextViewportWindowPosition
    );
  }
}

function scheduleStructuredTextViewportWindowPositionSync() {
  if (structuredTextViewportMoveFrame !== null
    || !liveStructuredTextViewportStates.size
    || typeof globalThis.requestAnimationFrame !== 'function') return;
  structuredTextViewportMoveFrame = globalThis.requestAnimationFrame(
    synchronizeStructuredTextViewportWindowPosition
  );
}

function disconnectStructuredTextViewport(runtime, area = runtime?.dom?.canvasArea) {
  const state = area && structuredTextViewportStates.get(area);
  if (!state || (runtime && state.runtime !== runtime)) return false;
  state.observer?.disconnect?.();
  structuredTextViewportStates.delete(area);
  liveStructuredTextViewportStates.delete(state);
  if (!liveStructuredTextViewportStates.size && structuredTextViewportMoveFrame !== null) {
    globalThis.cancelAnimationFrame?.(structuredTextViewportMoveFrame);
    structuredTextViewportMoveFrame = null;
  }
  return true;
}

function observeStructuredTextViewport(runtime, { stage, area, page } = {}) {
  if (!runtimeIsLive(runtime) || !stage || !area || !page?.id
    || typeof ResizeObserver !== 'function') {
    disconnectStructuredTextViewport(runtime, area);
    return null;
  }
  const tabId = runtime.session?.activeTab?.()?.id || null;
  let state = structuredTextViewportStates.get(area);
  if (!state) {
    state = {
      runtime,
      operation: captureRuntimeOperation(runtime, {
        scope: 'structured-text-viewport',
        pageId: page.id
      }),
      tabId,
      pageId: page.id,
      stage,
      area,
      viewport: structuredTextViewportRect(area),
      pendingWindowMove: null,
      observer: null
    };
    state.observer = new ResizeObserver(() => {
      if (!state.area?.isConnected || !runtimeOperationIsCurrent(state.operation)) {
        disconnectStructuredTextViewport(state.runtime, state.area);
        return;
      }
      const nextViewport = structuredTextViewportRect(state.area);
      if (nextViewport) applyStructuredTextViewportResize(
        state.runtime,
        state,
        nextViewport
      );
    });
    state.observer.observe(area);
    structuredTextViewportStates.set(area, state);
    liveStructuredTextViewportStates.add(state);
    scheduleStructuredTextViewportWindowPositionSync();
    return state;
  }
  if (state.runtime !== runtime || !runtimeOperationIsCurrent(state.operation)) {
    state.runtime = runtime;
    state.operation = captureRuntimeOperation(runtime, {
      scope: 'structured-text-viewport',
      pageId: page.id
    });
  }
  state.stage = stage;
  state.area = area;
  if (state.pageId !== page.id || state.tabId !== tabId) {
    state.pageId = page.id;
    state.tabId = tabId;
    state.viewport = structuredTextViewportRect(area);
    state.pendingWindowMove = null;
    state.operation = captureRuntimeOperation(runtime, {
      scope: 'structured-text-viewport',
      pageId: page.id
    });
  }
  liveStructuredTextViewportStates.add(state);
  scheduleStructuredTextViewportWindowPositionSync();
  return state;
}

function fitStructuredTextCameraToFrame(frame, area, view) {
  const normalized = globalThis.structuredTextFrameModel?.normalizeTextFrame?.(frame)
    || { centerWorldX: 0 };
  view.scale = 1;
  view.offsetX = area.clientWidth / 2 - normalized.centerWorldX * view.scale;
  view.offsetY = 0;
  return view;
}

function writeCanvasTransform(runtime) {
  writeCanvasTransformFor(
    runtime.dom.canvasStage,
    runtime.dom.canvasArea,
    runtime.canvasView
  );
}

function clampMarkdownVerticalOffsetForCanvas(runtime) {
  const { canvasArea, canvasStage } = runtime.dom;
  const markdownActive = typeof pageIsMarkdown === 'function'
    && pageIsMarkdown(runtime.currentPage);
  const hnTextActive = typeof pageIsHnText === 'function'
    && pageIsHnText(runtime.currentPage);
  const clampOffset = hnTextActive
    ? globalThis.structuredTextPageShell?.clampVerticalOffset
    : globalThis.markdownPageView?.clampMarkdownVerticalOffset;
  const bounds = markdownActive && typeof getMarkdownDocumentBounds === 'function'
    ? getMarkdownDocumentBounds(canvasStage)
    : hnTextActive && typeof getHnTextDocumentBounds === 'function'
      ? getHnTextDocumentBounds(canvasStage)
      : null;
  if (!bounds || typeof clampOffset !== 'function') return false;
  runtime.canvasView.offsetY = clampOffset({
    offsetY: runtime.canvasView.offsetY,
    scale: runtime.canvasView.scale,
    viewportHeight: canvasArea.clientHeight,
    documentTop: bounds.top,
    documentBottom: bounds.bottom,
    topInset: 0,
    bottomInset: 0
  });
  return true;
}

function applyCanvasTransform(runtime) {
  clampMarkdownVerticalOffsetForCanvas(runtime);
  writeCanvasTransform(runtime);
  if (runtime === activePaneRuntime()) {
    if (typeof refreshMarkdownControlStrip === 'function') {
      refreshMarkdownControlStrip(runtime);
    }
    if (typeof refreshHnTextControlStrip === 'function') {
      refreshHnTextControlStrip(runtime);
    }
  }
  positionQuickColourBar(runtime);
}

function pageWorldIsRenderable(runtime) {
  return runtime.canvasObjects.length > 0
    || (typeof pageIsMarkdown === 'function' && pageIsMarkdown(runtime.currentPage))
    || (typeof pageIsHnText === 'function' && pageIsHnText(runtime.currentPage));
}

function combinedCanvasWorldBounds(objects = [], markdownBounds = null) {
  const objectBounds = objects.length ? getObjectBounds(objects) : null;
  if (!markdownBounds) return objectBounds;
  if (!objectBounds) {
    return {
      minX: markdownBounds.left,
      minY: markdownBounds.top,
      maxX: markdownBounds.right,
      maxY: markdownBounds.bottom,
      width: markdownBounds.width,
      height: markdownBounds.height
    };
  }
  const minX = Math.min(objectBounds.minX, markdownBounds.left);
  const minY = Math.min(objectBounds.minY, markdownBounds.top);
  const maxX = Math.max(objectBounds.maxX, markdownBounds.right);
  const maxY = Math.max(objectBounds.maxY, markdownBounds.bottom);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function applyCanvasWorldBounds(runtime, bounds, stage = runtime.dom.canvasStage) {
  stage.style.width = `${Math.max(1, bounds?.maxX || bounds?.width || 1)}px`;
  stage.style.height = `${Math.max(1, bounds?.maxY || bounds?.height || 1)}px`;
}

function refreshPaneMarkdownWorldBounds(runtime, stage = runtime?.dom?.canvasStage) {
  if (!runtimeIsLive(runtime) || !stage
    || typeof getMarkdownDocumentBounds !== 'function') return null;
  const objects = runtime.canvasObjects || [];
  const markdownBounds = getMarkdownDocumentBounds(stage);
  const bounds = combinedCanvasWorldBounds(objects, markdownBounds);
  applyCanvasWorldBounds(runtime, bounds, stage);
  runtime.canvasBounds = bounds;
  const view = runtime.canvasView;
  const area = runtime.dom.canvasArea;
  const clampOffset = globalThis.markdownPageView?.clampMarkdownVerticalOffset;
  if (view && area && typeof clampOffset === 'function') {
    view.offsetY = clampOffset({
      offsetY: view.offsetY,
      scale: view.scale,
      viewportHeight: area.clientHeight,
      documentTop: markdownBounds?.top || 0,
      documentBottom: markdownBounds?.bottom || 0,
      topInset: 0,
      bottomInset: 0
    });
    writeCanvasTransformFor(stage, area, view);
  }
  return bounds;
}

function refreshPaneStructuredTextWorldBounds(runtime, stage = runtime?.dom?.canvasStage) {
  if (!runtimeIsLive(runtime) || !stage
    || typeof getHnTextDocumentBounds !== 'function') return null;
  const objects = runtime.canvasObjects || [];
  const documentBounds = getHnTextDocumentBounds(stage);
  const bounds = combinedCanvasWorldBounds(objects, documentBounds);
  applyCanvasWorldBounds(runtime, bounds, stage);
  runtime.canvasBounds = bounds;
  const view = runtime.canvasView;
  const area = runtime.dom.canvasArea;
  const clampOffset = globalThis.structuredTextPageShell?.clampVerticalOffset;
  if (view && area && documentBounds && typeof clampOffset === 'function') {
    view.offsetY = clampOffset({
      offsetY: view.offsetY,
      scale: view.scale,
      viewportHeight: area.clientHeight,
      documentTop: documentBounds.top,
      documentBottom: documentBounds.bottom
    });
    writeCanvasTransformFor(stage, area, view);
  }
  return bounds;
}

function markdownOwnsPointerEvent(runtime, event) {
  const target = event?.target;
  if (runtime.pageEditMode
    && target?.closest?.('.structured-text-page-frame.is-page-edit-mode')) {
    return Boolean(target.closest('.structured-text-page-frame-handle'));
  }
  if (typeof hnTextPageOwnsPointer === 'function' && hnTextPageOwnsPointer(target)) {
    return true;
  }
  if (typeof markdownSelectionGestureOwnsPointer === 'function'
    && markdownSelectionGestureOwnsPointer(event)) return true;
  if (runtime.pageEditMode && target?.closest?.('.markdown-page-layer.is-page-edit-mode')) {
    // Locked Markdown remains painted above editable Canvas Objects in Page
    // Edit, but only its narrow frame handles retain pointer ownership. The
    // rest of the text rectangle must pass through to coordinate-based Object
    // hit testing.
    return Boolean(target.closest('.markdown-page-frame-handle'));
  }
  return Boolean(typeof markdownPageOwnsPointer === 'function'
    && markdownPageOwnsPointer(target));
}

function fitCanvasToObjects(runtime, objects = runtime.canvasObjects) {
  if (!objects.length) return;

  runtime.canvasBounds = getObjectBounds(objects);
  const { canvasArea } = runtime.dom;
  const viewportWidth = canvasArea.clientWidth;
  const viewportHeight = canvasArea.clientHeight;
  const usableWidth = Math.max(1, viewportWidth - CANVAS_FIT_PADDING * 2);
  const usableHeight = Math.max(1, viewportHeight - CANVAS_FIT_PADDING * 2);

  runtime.canvasView.scale = clampCanvasScale(Math.min(
    usableWidth / runtime.canvasBounds.width,
    usableHeight / runtime.canvasBounds.height
  ));
  runtime.canvasView.offsetX = (
    viewportWidth - runtime.canvasBounds.width * runtime.canvasView.scale
  ) / 2 - runtime.canvasBounds.minX * runtime.canvasView.scale;
  runtime.canvasView.offsetY = (
    viewportHeight - runtime.canvasBounds.height * runtime.canvasView.scale
  ) / 2 - runtime.canvasBounds.minY * runtime.canvasView.scale;
  applyCanvasTransform(runtime);
}

function cloneBlocks(blocks = []) {
  return blocks.map((block) => ({
    ...block,
    rotation: Number.isFinite(block.rotation) ? block.rotation : 0,
    links: (block.links || []).map((link) => ({ ...link }))
  }));
}

function transactionalValuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function beginCanvasUndoContext(runtime, type) {
  const pageId = runtime.currentPage?.id || null;
  const contextId = `${type}:${runtime.runtimeId}:${pageId}`;
  runtime.canvasUndoContextId = contextId;
  undoManager.beginContext({ id: contextId, type, ownerId: pageId });
  return contextId;
}

function runtimeOwnsCanvasUndoContext(runtime) {
  const context = undoManager.activeContext();
  return Boolean(runtime?.canvasUndoContextId
    && context?.id === runtime.canvasUndoContextId);
}

function clearCanvasUndoContext(runtime, { commit = false } = {}) {
  if (!runtimeOwnsCanvasUndoContext(runtime)) return false;
  if (commit) undoManager.commitContext();
  else undoManager.cancelContext();
  runtime.canvasUndoContextId = null;
  return true;
}

function applyDraftBlockSnapshot(runtime, blocks, selectionId = null) {
  runtime.draftBlocks = cloneBlocks(blocks);
  runtime.selectedBlockId = runtime.draftBlocks.some((block) => block.id === selectionId)
    ? selectionId
    : null;
  renderBlockOverlays(runtime, runtime.draftBlocks);
  renderRelations(runtime, { ...runtime.currentPage, blocks: runtime.draftBlocks });
}

function recordDraftBlockChange(runtime, before, after, {
  undoSelection = null,
  redoSelection = null
} = {}) {
  if (!runtimeOwnsCanvasUndoContext(runtime)
    || transactionalValuesEqual(before, after)) return false;
  const undoBlocks = cloneBlocks(before);
  const redoBlocks = cloneBlocks(after);
  return undoManager.record({
    undo: () => {
      if (runtimeIsLive(runtime) && runtimeOwnsCanvasUndoContext(runtime)) {
        applyDraftBlockSnapshot(runtime, undoBlocks, undoSelection);
      }
    },
    redo: () => {
      if (runtimeIsLive(runtime) && runtimeOwnsCanvasUndoContext(runtime)) {
        applyDraftBlockSnapshot(runtime, redoBlocks, redoSelection);
      }
    }
  });
}

function normalizedCanvasBlockAppearance(value = null) {
  const currentSettings = appearanceSettingsModel.normalizeAppearanceSettings(
    typeof appearanceSettings === 'undefined' ? null : appearanceSettings
  );
  if (value && typeof value === 'object' && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, 'colourful')) {
    return appearanceSettingsModel.normalizeAppearanceSettings({
      ...currentSettings,
      blockAppearance: value
    }).blockAppearance;
  }
  return appearanceSettingsModel.normalizeAppearanceSettings(value || currentSettings)
    .blockAppearance;
}

function canvasBlockConcreteColour(block, blockAppearance = null) {
  const normalizedAppearance = normalizedCanvasBlockAppearance(blockAppearance);
  return appearanceSettingsModel.normalizeHexColour(block?.colour)
    || normalizedAppearance.monochrome.colour;
}

function colourfulBlockStyleVariables(block, blockAppearance = null) {
  const normalizedAppearance = normalizedCanvasBlockAppearance(blockAppearance);
  const variables = appearanceSettingsModel.blockStatusColourVariables(
    canvasBlockConcreteColour(block, normalizedAppearance),
    normalizedAppearance.monochrome.opacity
  );
  return Object.fromEntries(Object.entries(variables).map(([name, value]) => [
    name.replace('--block-status-', '--block-colourful-status-'),
    value
  ]));
}

function clearColourfulBlockStyle(element) {
  if (!element?.style) return;
  for (const name of BLOCK_COLOURFUL_STYLE_NAMES) {
    if (typeof element.style.removeProperty === 'function') element.style.removeProperty(name);
    else element.style.setProperty?.(name, '');
  }
}

function applyColourfulBlockStyle(element, block, blockAppearance = null) {
  if (!element?.style) return;
  const normalizedAppearance = normalizedCanvasBlockAppearance(blockAppearance);
  clearColourfulBlockStyle(element);
  if (!normalizedAppearance.colourful) return;
  for (const [name, value] of Object.entries(
    colourfulBlockStyleVariables(block, normalizedAppearance)
  )) {
    element.style.setProperty(name, value);
  }
}

function quickColourState(runtime) {
  if (!runtime.quickColour) {
    runtime.quickColour = {
      blockId: null,
      pageId: null,
      overlayHost: null,
      resizeObserver: null,
      manualPosition: null,
      drag: null,
      suppressClickTimer: null,
      suppressNextClick: false,
      generation: 0
    };
  }
  return runtime.quickColour;
}

function quickColourPaletteSnapshot() {
  try {
    const snapshot = globalThis.blockColourPaletteController?.snapshot?.();
    if (snapshot) return snapshot;
  } catch (error) {
    console.error('[appearance:quick-colour-snapshot]', error);
  }
  const blockAppearance = normalizedCanvasBlockAppearance();
  return Object.freeze({
    colourful: blockAppearance.colourful,
    presets: Object.freeze(blockAppearance.colourfulBlock.presets.map((preset) => (
      Object.freeze({ ...preset })
    ))),
    lastUsedColour: blockAppearance.colourfulBlock.lastUsedColour,
    monochromeColour: blockAppearance.monochrome.colour,
    opacity: Object.freeze({ ...blockAppearance.monochrome.opacity }),
    borderWidth: blockAppearance.monochrome.borderWidth
  });
}

function resolveQuickColourTarget(runtime, {
  expectedBlockId = quickColourState(runtime).blockId,
  expectedPageId = quickColourState(runtime).pageId,
  generation = quickColourState(runtime).generation
} = {}) {
  const quickColour = quickColourState(runtime);
  if (runtime !== activePaneRuntime()
    || !expectedBlockId
    || expectedBlockId !== quickColour.blockId
    || !expectedPageId
    || expectedPageId !== quickColour.pageId
    || generation !== quickColour.generation
    || runtime.currentPage?.id !== expectedPageId
    || !runtime.blockEditMode
    || runtime.pageEditMode
    || runtime.selectedBlockId !== expectedBlockId
    || !normalizedCanvasBlockAppearance().colourful) return null;
  return runtime.draftBlocks.find((block) => block.id === expectedBlockId) || null;
}

function clearQuickColourBarDrag(runtime) {
  const quickColour = quickColourState(runtime);
  const drag = quickColour.drag;
  quickColour.drag = null;
  drag?.bar?.classList?.remove('is-dragging');
  if (drag?.handle?.hasPointerCapture?.(drag.pointerId)) {
    drag.handle.releasePointerCapture(drag.pointerId);
  }
}

function closeQuickColourBar(runtime) {
  const quickColour = quickColourState(runtime);
  clearQuickColourBarDrag(runtime);
  clearTimeout(quickColour.suppressClickTimer);
  quickColour.suppressClickTimer = null;
  quickColour.suppressNextClick = false;
  quickColour.manualPosition = null;
  quickColour.blockId = null;
  quickColour.pageId = null;
  quickColour.generation += 1;
  quickColour.resizeObserver?.disconnect?.();
  quickColour.resizeObserver = null;
  quickColour.overlayHost?.remove?.();
  quickColour.overlayHost = null;
}

function ensureQuickColourOverlayHost(runtime) {
  const quickColour = quickColourState(runtime);
  const { canvasArea } = runtime.dom;
  if (runtime !== activePaneRuntime() || !canvasArea?.isConnected) return null;
  if (quickColour.overlayHost?.isConnected
    && quickColour.overlayHost.parentElement === canvasArea) return quickColour.overlayHost;
  quickColour.resizeObserver?.disconnect?.();
  quickColour.overlayHost?.remove?.();
  const host = document.createElement('div');
  host.className = 'canvas-block-quick-colour-overlay';
  host.dataset.paneRole = 'canvas-quick-colour-overlay';
  host.setAttribute('aria-live', 'off');
  canvasArea.append(host);
  quickColour.overlayHost = host;
  if (typeof globalThis.ResizeObserver === 'function') {
    quickColour.resizeObserver = new globalThis.ResizeObserver(() => {
      positionQuickColourBar(runtime);
    });
    quickColour.resizeObserver.observe(canvasArea);
  }
  return host;
}

function quickColourBarElement(runtime) {
  return quickColourState(runtime).overlayHost
    ?.querySelector?.('.canvas-block-quick-colour-bar') || null;
}

function quickColourRainbowElement(runtime) {
  return quickColourBarElement(runtime)
    ?.querySelector?.('[data-quick-colour-rainbow]') || null;
}

function clampQuickColourBarPosition(
  runtime,
  left,
  top,
  bar = quickColourBarElement(runtime)
) {
  const { canvasArea } = runtime.dom;
  const areaWidth = Math.max(0, Number(canvasArea?.clientWidth) || 0);
  const areaHeight = Math.max(0, Number(canvasArea?.clientHeight) || 0);
  const measured = bar?.getBoundingClientRect?.() || {};
  const barWidth = bar?.offsetWidth || measured.width || 0;
  const barHeight = bar?.offsetHeight || measured.height || 0;
  const minimumLeft = QUICK_COLOUR_VIEWPORT_PADDING;
  const minimumTop = QUICK_COLOUR_VIEWPORT_PADDING;
  const maximumLeft = Math.max(
    minimumLeft,
    areaWidth - barWidth - QUICK_COLOUR_VIEWPORT_PADDING
  );
  const maximumTop = Math.max(
    minimumTop,
    areaHeight - barHeight - QUICK_COLOUR_VIEWPORT_PADDING
  );
  return {
    left: Math.min(maximumLeft, Math.max(minimumLeft, left)),
    top: Math.min(maximumTop, Math.max(minimumTop, top))
  };
}

function writeQuickColourBarPosition(runtime, position, { clampToViewport = true } = {}) {
  const bar = quickColourBarElement(runtime);
  if (!bar || !position) return null;
  const clamped = clampToViewport
    ? clampQuickColourBarPosition(runtime, position.left, position.top, bar)
    : position;
  const rounded = {
    left: Math.round(clamped.left * 100) / 100,
    top: Math.round(clamped.top * 100) / 100
  };
  bar.style.left = `${rounded.left}px`;
  bar.style.top = `${rounded.top}px`;
  return rounded;
}

function quickColourDefaultPosition(
  runtime,
  target = resolveQuickColourTarget(runtime),
  bar = quickColourBarElement(runtime)
) {
  const overlay = target && blockOverlay(runtime, target.id);
  if (!target || !bar || !overlay?.isConnected) return null;
  const { canvasArea } = runtime.dom;
  const areaRect = canvasArea.getBoundingClientRect();
  const targetRect = overlay.getBoundingClientRect();
  const measuredBarRect = bar.getBoundingClientRect();
  const barWidth = bar.offsetWidth || measuredBarRect.width || 252;
  const preferredLeft = (targetRect.left + targetRect.right) / 2
    - areaRect.left - barWidth / 2;
  const maximumLeft = Math.max(
    QUICK_COLOUR_VIEWPORT_PADDING,
    (Number(canvasArea.clientWidth) || areaRect.width) - barWidth - QUICK_COLOUR_VIEWPORT_PADDING
  );
  return {
    left: Math.min(maximumLeft, Math.max(QUICK_COLOUR_VIEWPORT_PADDING, preferredLeft)),
    top: targetRect.bottom - areaRect.top + QUICK_COLOUR_TARGET_GAP
  };
}

function suppressNextQuickColourClick(runtime) {
  const quickColour = quickColourState(runtime);
  clearTimeout(quickColour.suppressClickTimer);
  quickColour.suppressNextClick = true;
  quickColour.suppressClickTimer = setTimeout(() => {
    quickColour.suppressNextClick = false;
    quickColour.suppressClickTimer = null;
  }, 0);
}

function consumeSuppressedQuickColourClick(runtime, event) {
  const quickColour = quickColourState(runtime);
  if (!quickColour.suppressNextClick) return false;
  clearTimeout(quickColour.suppressClickTimer);
  quickColour.suppressClickTimer = null;
  quickColour.suppressNextClick = false;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  return true;
}

function quickColourPointerAction(runtime, event, bar) {
  const control = event.target?.closest?.(
    '[data-quick-colour-rainbow], [data-block-colour-preset-id]'
  );
  if (!control || control.closest?.('.canvas-block-quick-colour-bar') !== bar) return null;
  if (control.dataset.quickColourRainbow === 'true') return { type: 'rainbow' };
  const presetId = control.dataset.blockColourPresetId;
  const preset = quickColourPaletteSnapshot().presets.find((item) => item.id === presetId);
  return preset ? { type: 'preset', preset } : null;
}

function beginQuickColourBarDrag(runtime, event) {
  if (event.button !== 0 || event.isPrimary === false
    || !resolveQuickColourTarget(runtime)) return;
  const quickColour = quickColourState(runtime);
  const { canvasArea } = runtime.dom;
  const bar = event.currentTarget || quickColourBarElement(runtime);
  if (!bar) return;
  const areaRect = canvasArea.getBoundingClientRect();
  const barRect = bar.getBoundingClientRect();
  const defaultPosition = quickColourDefaultPosition(runtime);
  const styleLeft = Number.parseFloat(bar.style.left);
  const styleTop = Number.parseFloat(bar.style.top);
  if (!defaultPosition) return;
  quickColour.drag = {
    operation: captureRuntimeOperation(runtime, {
      scope: 'quick-colour-drag',
      pageId: runtime.currentPage?.id || null,
      generation: quickColour.generation,
      pointerId: event.pointerId
    }),
    pointerId: event.pointerId,
    handle: bar,
    bar,
    action: quickColourPointerAction(runtime, event, bar),
    startClientX: event.clientX,
    startClientY: event.clientY,
    startLeft: Number.isFinite(styleLeft) ? styleLeft : barRect.left - areaRect.left,
    startTop: Number.isFinite(styleTop) ? styleTop : barRect.top - areaRect.top,
    defaultLeft: defaultPosition.left,
    defaultTop: defaultPosition.top,
    dragged: false
  };
  bar.setPointerCapture?.(event.pointerId);
  event.stopPropagation();
  event.stopImmediatePropagation?.();
}

function updateQuickColourBarDrag(runtime, event) {
  const quickColour = quickColourState(runtime);
  const drag = quickColour.drag;
  if (!drag || !runtimeOperationIsCurrent(drag.operation)
    || drag.operation.generation !== quickColour.generation
    || event.pointerId !== drag.pointerId) return;
  const deltaX = event.clientX - drag.startClientX;
  const deltaY = event.clientY - drag.startClientY;
  if (!drag.dragged && Math.hypot(deltaX, deltaY) < QUICK_COLOUR_DRAG_THRESHOLD) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (!drag.dragged) {
    drag.dragged = true;
    drag.bar.classList.add('is-dragging');
  }
  const written = writeQuickColourBarPosition(runtime, {
    left: drag.startLeft + deltaX,
    top: drag.startTop + deltaY
  });
  if (written) {
    quickColour.manualPosition = {
      offsetX: written.left - drag.defaultLeft,
      offsetY: written.top - drag.defaultTop
    };
  }
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
}

function finishQuickColourBarDrag(runtime, event, { cancelled = false } = {}) {
  const quickColour = quickColourState(runtime);
  const drag = quickColour.drag;
  if (!drag || !runtimeOperationIsCurrent(drag.operation)
    || drag.operation.generation !== quickColour.generation
    || event.pointerId !== drag.pointerId) return;
  const dragged = drag.dragged;
  const action = drag.action;
  clearQuickColourBarDrag(runtime);
  suppressNextQuickColourClick(runtime);
  if (dragged || cancelled) event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  if (cancelled || dragged) return;
  if (action?.type === 'rainbow') openQuickColourPicker(runtime);
  else if (action?.type === 'preset') applyQuickColourPreset(runtime, action.preset);
}

function handleQuickColourBarLostPointerCapture(runtime, event) {
  const quickColour = quickColourState(runtime);
  const drag = quickColour.drag;
  if (!drag || !runtimeOperationIsCurrent(drag.operation)
    || drag.operation.generation !== quickColour.generation
    || event.pointerId !== drag.pointerId) return;
  const dragged = drag.dragged;
  clearQuickColourBarDrag(runtime);
  if (dragged) suppressNextQuickColourClick(runtime);
}

function handleQuickColourRainbowClick(runtime, event) {
  if (consumeSuppressedQuickColourClick(runtime, event)) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  openQuickColourPicker(runtime);
}

function handleQuickColourBarClick(runtime, event) {
  if (consumeSuppressedQuickColourClick(runtime, event)) return;
  event.stopPropagation();
  event.stopImmediatePropagation?.();
}

function handleQuickColourBarWheel(runtime, event) {
  const bar = quickColourBarElement(runtime);
  const scroller = bar?.querySelector?.('[data-quick-colour-presets]');
  if (!bar || !scroller) return;
  const unit = event.deltaMode === 1
    ? 16
    : event.deltaMode === 2 ? Math.max(1, scroller.clientWidth) : 1;
  const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
    ? event.deltaX : event.deltaY;
  scroller.scrollLeft += rawDelta * unit;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
}

function recolourQuickColourBlock(
  runtime,
  colour,
  expectedBlockId = quickColourState(runtime).blockId,
  expectedPageId = quickColourState(runtime).pageId,
  generation = quickColourState(runtime).generation
) {
  const normalized = appearanceSettingsModel.normalizeHexColour(colour);
  const block = resolveQuickColourTarget(runtime, {
    expectedBlockId,
    expectedPageId,
    generation
  });
  if (!normalized || !block) return false;
  if (block.colour === normalized) {
    renderBlockOverlays(runtime, runtime.draftBlocks);
    return true;
  }
  const beforeBlocks = cloneBlocks(runtime.draftBlocks);
  block.colour = normalized;
  recordDraftBlockChange(runtime, beforeBlocks, runtime.draftBlocks, {
    undoSelection: block.id,
    redoSelection: block.id
  });
  runtime.selectedBlockId = block.id;
  renderBlockOverlays(runtime, runtime.draftBlocks);
  renderRelations(runtime, { ...runtime.currentPage, blocks: runtime.draftBlocks });
  return true;
}

function persistQuickColour(colour) {
  const controller = globalThis.blockColourPaletteController;
  if (!controller?.persistQuickColour) {
    return Promise.reject(new Error('The Block colour palette is unavailable.'));
  }
  return controller.persistQuickColour(colour);
}

function applyQuickColourPreset(runtime, preset) {
  const quickColour = quickColourState(runtime);
  const { blockId, pageId, generation } = quickColour;
  if (!preset || !recolourQuickColourBlock(
    runtime,
    preset.colour,
    blockId,
    pageId,
    generation
  )) return;
  persistQuickColour(preset.colour).catch((error) => {
    if (resolveQuickColourTarget(runtime, {
      expectedBlockId: blockId,
      expectedPageId: pageId,
      generation
    })) {
      showRuntimeStatus(
        runtime,
        error.message || 'The Block colour could not be saved.',
        true
      );
    }
  });
}

function openQuickColourPicker(runtime) {
  const quickColour = quickColourState(runtime);
  const { blockId, pageId, generation } = quickColour;
  const block = resolveQuickColourTarget(runtime, {
    expectedBlockId: blockId,
    expectedPageId: pageId,
    generation
  });
  const controller = globalThis.blockColourPaletteController;
  if (!block || !controller?.openQuickColourPicker) return false;
  return controller.openQuickColourPicker({
    title: 'New Colour',
    initialColour: canvasBlockConcreteColour(block),
    returnFocus: () => quickColourRainbowElement(runtime) || runtime.dom.canvasArea,
    validateTarget: () => resolveQuickColourTarget(runtime, {
      expectedBlockId: blockId,
      expectedPageId: pageId,
      generation
    }),
    onPersisted: ({ colour }) => {
      recolourQuickColourBlock(runtime, colour, blockId, pageId, generation);
    }
  });
}

function syncQuickColourBarCurrentColour(
  runtime,
  target = resolveQuickColourTarget(runtime),
  bar = quickColourBarElement(runtime)
) {
  if (!target || !bar) return;
  const currentColour = appearanceSettingsModel.normalizeHexColour(
    canvasBlockConcreteColour(target)
  );
  let matched = false;
  for (const button of bar.querySelectorAll('[data-block-colour-preset-id]')) {
    const presetColour = appearanceSettingsModel.normalizeHexColour(
      button.dataset.blockColourPresetColour
    );
    const current = !matched && Boolean(currentColour) && presetColour === currentColour;
    button.setAttribute('aria-pressed', String(current));
    if (current) matched = true;
  }
}

function buildQuickColourBar(runtime, target) {
  const host = ensureQuickColourOverlayHost(runtime);
  if (!host || !target) return null;
  const quickColour = quickColourState(runtime);
  const operation = captureRuntimeOperation(runtime, {
    scope: 'quick-colour-bar',
    pageId: runtime.currentPage?.id || null,
    generation: quickColour.generation,
    blockId: target.id
  });
  const barIsCurrent = () => runtimeOperationIsCurrent(operation)
    && quickColourState(runtime).generation === operation.generation;
  const palette = quickColourPaletteSnapshot();
  if (!palette.colourful) {
    closeQuickColourBar(runtime);
    return null;
  }

  const bar = document.createElement('div');
  bar.className = 'canvas-block-quick-colour-bar';
  bar.dataset.quickColourBlockId = target.id;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Block colours');

  const rainbow = document.createElement('button');
  rainbow.type = 'button';
  rainbow.className = 'canvas-block-quick-colour-rainbow';
  rainbow.dataset.quickColourRainbow = 'true';
  rainbow.setAttribute('aria-label', 'Choose another Block colour');
  rainbow.title = 'Choose another colour';
  const rainbowCircle = document.createElement('span');
  rainbowCircle.className = 'vault-block-rainbow-circle';
  rainbowCircle.setAttribute('aria-hidden', 'true');
  rainbow.append(rainbowCircle);
  rainbow.addEventListener('click', (event) => {
    if (barIsCurrent()) handleQuickColourRainbowClick(runtime, event);
  });

  const separator = document.createElement('span');
  separator.className = 'canvas-block-quick-colour-separator';
  separator.dataset.quickColourSeparator = 'true';
  separator.setAttribute('aria-hidden', 'true');

  const presets = document.createElement('div');
  presets.className = 'canvas-block-quick-colour-presets vault-block-colour-presets';
  presets.dataset.quickColourPresets = 'true';
  presets.setAttribute('role', 'group');
  presets.setAttribute('aria-label', 'Preset Block colours');
  for (const preset of palette.presets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'vault-block-colour-preset';
    button.dataset.blockColourPresetId = preset.id;
    button.dataset.blockColourPresetColour = preset.colour;
    button.style.setProperty('--block-preset-colour', preset.colour);
    button.setAttribute('aria-label', `Use ${preset.colour}`);
    button.setAttribute('aria-pressed', 'false');
    button.title = preset.colour;
    button.addEventListener('click', (event) => {
      if (!barIsCurrent()) return;
      if (consumeSuppressedQuickColourClick(runtime, event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      applyQuickColourPreset(runtime, preset);
    });
    presets.append(button);
  }
  bar.append(rainbow, separator, presets);
  syncQuickColourBarCurrentColour(runtime, target, bar);
  bar.addEventListener('pointerdown', (event) => {
    if (barIsCurrent()) beginQuickColourBarDrag(runtime, event);
  });
  bar.addEventListener('pointermove', (event) => {
    if (barIsCurrent()) updateQuickColourBarDrag(runtime, event);
  });
  bar.addEventListener('pointerup', (event) => {
    if (barIsCurrent()) finishQuickColourBarDrag(runtime, event);
  });
  bar.addEventListener('pointercancel', (event) => {
    if (barIsCurrent()) {
      finishQuickColourBarDrag(runtime, event, { cancelled: true });
    }
  });
  bar.addEventListener('lostpointercapture', (event) => (
    barIsCurrent() && handleQuickColourBarLostPointerCapture(runtime, event)
  ));
  bar.addEventListener('wheel', (event) => {
    if (barIsCurrent()) handleQuickColourBarWheel(runtime, event);
  }, { passive: false });
  for (const eventName of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    bar.addEventListener(eventName, (event) => event.stopPropagation());
  }
  bar.addEventListener('click', (event) => {
    if (barIsCurrent()) handleQuickColourBarClick(runtime, event);
  });
  for (const eventName of ['gesturestart', 'gesturechange', 'gestureend']) {
    bar.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { passive: false });
  }
  bar.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  bar.addEventListener('keydown', (event) => {
    if (event.key === 'Enter'
      && globalThis.textEditingModel?.isImeCompositionOwnedKeyEvent?.(event, bar)) return;
    if (['Delete', 'Backspace'].includes(event.key)) event.preventDefault();
    if (['Enter', ' ', 'Spacebar', 'Delete', 'Backspace'].includes(event.key)) {
      event.stopPropagation();
    }
  });
  host.replaceChildren(bar);
  positionQuickColourBar(runtime);
  const positionOperation = captureRuntimeOperation(runtime, {
    scope: 'quick-colour-position',
    pageId: runtime.currentPage?.id || null,
    generation: quickColourState(runtime).generation
  });
  globalThis.requestAnimationFrame?.(() => {
    if (runtimeOperationIsCurrent(positionOperation)) positionQuickColourBar(runtime);
  });
  return bar;
}

function positionQuickColourBar(runtime) {
  const quickColour = quickColourState(runtime);
  if (!quickColour.blockId || runtime !== activePaneRuntime()) return;
  const target = resolveQuickColourTarget(runtime);
  const host = quickColour.overlayHost;
  const bar = quickColourBarElement(runtime);
  const overlay = target && blockOverlay(runtime, target.id);
  if (!target || !host || !bar) return;
  syncQuickColourBarCurrentColour(runtime, target, bar);
  if (!overlay?.isConnected) {
    host.hidden = true;
    return;
  }
  const areaRect = runtime.dom.canvasArea.getBoundingClientRect();
  const targetRect = overlay.getBoundingClientRect();
  const isVisible = targetRect.right > areaRect.left
    && targetRect.left < areaRect.right
    && targetRect.bottom > areaRect.top
    && targetRect.top < areaRect.bottom;
  if (!isVisible || areaRect.width <= 0 || areaRect.height <= 0) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const defaultPosition = quickColourDefaultPosition(runtime, target, bar);
  if (!defaultPosition) return;
  if (quickColour.manualPosition) {
    writeQuickColourBarPosition(runtime, {
      left: defaultPosition.left + quickColour.manualPosition.offsetX,
      top: defaultPosition.top + quickColour.manualPosition.offsetY
    });
  } else {
    writeQuickColourBarPosition(runtime, defaultPosition, { clampToViewport: false });
  }
}

function reconcileQuickColourBar(runtime, { rebuild = false } = {}) {
  const quickColour = quickColourState(runtime);
  const target = runtime === activePaneRuntime()
    && runtime.blockEditMode
    && !runtime.pageEditMode
    && !runtime.blockTransform?.quickColourSuppressed
    && normalizedCanvasBlockAppearance().colourful
    ? runtime.draftBlocks.find((block) => block.id === runtime.selectedBlockId) || null
    : null;
  if (!target || !blockOverlay(runtime, target.id)) {
    if (quickColour.blockId || quickColour.overlayHost) closeQuickColourBar(runtime);
    return null;
  }
  const targetChanged = quickColour.blockId !== target.id
    || quickColour.pageId !== runtime.currentPage?.id;
  if (targetChanged) {
    closeQuickColourBar(runtime);
    quickColour.blockId = target.id;
    quickColour.pageId = runtime.currentPage.id;
  }
  const bar = quickColourBarElement(runtime);
  if (rebuild || targetChanged || !bar || bar.dataset.quickColourBlockId !== target.id) {
    return buildQuickColourBar(runtime, target);
  } else positionQuickColourBar(runtime);
  return bar;
}

function paintBlockColoursInStage(stage, blocks, blockAppearance) {
  if (!stage?.querySelectorAll) return;
  const byId = new Map((blocks || []).map((block) => [block.id, block]));
  for (const overlay of stage.querySelectorAll('.canvas-block-overlay[data-block-id]')) {
    const block = byId.get(overlay.dataset.blockId);
    if (block) applyColourfulBlockStyle(overlay, block, blockAppearance);
    else clearColourfulBlockStyle(overlay);
  }
}

function refreshCanvasBlockAppearance(blockAppearance = null) {
  const normalizedAppearance = normalizedCanvasBlockAppearance(blockAppearance);
  const activeRuntime = activePaneRuntime();
  for (const runtime of livingPaneRuntimes()) {
    const stage = runtime.dom?.canvasStage;
    const pageBlocks = runtime.blockEditMode
      ? runtime.draftBlocks
      : (runtime.currentPage?.blocks || []);
    paintBlockColoursInStage(stage, pageBlocks, normalizedAppearance);
    if (runtime.blockPreview) {
      applyColourfulBlockStyle(
        runtime.blockPreview,
        runtime.blockDrawing,
        normalizedAppearance
      );
    }
    if (runtime !== activeRuntime || !normalizedAppearance.colourful) {
      closeQuickColourBar(runtime);
    } else {
      reconcileQuickColourBar(runtime, { rebuild: true });
    }
  }
  return normalizedAppearance;
}

const BLOCK_INTERACTION_KIND = Object.freeze({
  NONE: 'none',
  ACTIVATE_TARGET: 'activate-target',
  SELECT_BLOCK_EDIT: 'select-block-edit',
  EDIT_HIGHLIGHT_MEMBERSHIP: 'edit-highlight-membership'
});

// Presentation requests belong to the Pane runtime and logical Block, not to
// one disposable overlay. This global broker stores only exact runtime tokens;
// the mutable request maps themselves remain on each runtime.
const blockPresentationOwners = new WeakMap();

function deriveBlockPresentationInteraction(block, {
  mode = BLOCK_MODE.NORMAL,
  selectedBlockId: semanticSelectedBlockId = null,
  activeHighlightBlockIds: semanticActiveHighlightBlockIds = new Set(),
  selectedHighlightBlockIds: semanticSelectedHighlightBlockIds = new Set(),
  presentationStates = []
} = {}) {
  const validBlock = Boolean(block && typeof block.id === 'string' && block.id);
  const activeHighlightMember = validBlock
    && Boolean(semanticActiveHighlightBlockIds?.has?.(block.id));
  let basePresentationState = BLOCK_STATE.HIDDEN;
  let interactive = false;
  let interactionKind = BLOCK_INTERACTION_KIND.NONE;

  if (validBlock) {
    switch (mode) {
      case BLOCK_MODE.BLOCK_EDIT:
        basePresentationState = semanticSelectedBlockId === block.id
          ? BLOCK_STATE.ACTIVE
          : BLOCK_STATE.HIGHLIGHTED;
        interactive = true;
        interactionKind = BLOCK_INTERACTION_KIND.SELECT_BLOCK_EDIT;
        break;
      case BLOCK_MODE.HIGHLIGHT_VIEW:
        basePresentationState = activeHighlightMember
          ? BLOCK_STATE.DEFAULT
          : BLOCK_STATE.HIDDEN;
        interactive = activeHighlightMember;
        interactionKind = activeHighlightMember
          ? BLOCK_INTERACTION_KIND.ACTIVATE_TARGET
          : BLOCK_INTERACTION_KIND.NONE;
        break;
      case BLOCK_MODE.HIGHLIGHT_EDIT:
        basePresentationState = semanticSelectedHighlightBlockIds?.has?.(block.id)
          ? BLOCK_STATE.ACTIVE
          : BLOCK_STATE.HIGHLIGHTED;
        interactive = true;
        interactionKind = BLOCK_INTERACTION_KIND.EDIT_HIGHLIGHT_MEMBERSHIP;
        break;
      default:
        basePresentationState = BLOCK_STATE.DEFAULT;
        interactive = true;
        interactionKind = BLOCK_INTERACTION_KIND.ACTIVATE_TARGET;
        break;
    }
  }

  const requestedPresentationState = Math.max(
    basePresentationState,
    ...Array.from(presentationStates || [])
      .filter((state) => Number.isFinite(state))
  );
  const presentationState = mode === BLOCK_MODE.HIGHLIGHT_VIEW
      && validBlock && !activeHighlightMember
    ? BLOCK_STATE.HIDDEN
    : requestedPresentationState;

  return { presentationState, interactive, interactionKind };
}

function currentBlockPresentationInteraction(runtime, block, presentationStates = []) {
  return deriveBlockPresentationInteraction(block, {
    mode: runtime.blockVisualMode,
    selectedBlockId: runtime.selectedBlockId,
    activeHighlightBlockIds: runtime.activeHighlightBlockIds,
    selectedHighlightBlockIds: runtime.selectedHighlightBlockIds,
    presentationStates
  });
}

function blockPresentationRequestKey(runtime, block) {
  if (!block || typeof block.id !== 'string' || !block.id) return null;
  return JSON.stringify([runtime.currentPage?.id || '', block.id]);
}

function blockPresentationRequestStore(runtime) {
  const { canvasStage } = runtime.dom;
  let store = runtime.blockStateRequests.get(canvasStage);
  if (!store) {
    store = new Map();
    runtime.blockStateRequests.set(canvasStage, store);
  }
  return store;
}

function blockPresentationRequests(runtime, overlay, block, { create = true } = {}) {
  const { canvasStage } = runtime.dom;
  const requestKey = blockPresentationRequestKey(runtime, block);
  if (requestKey) {
    const store = create
      ? blockPresentationRequestStore(runtime)
      : runtime.blockStateRequests.get(canvasStage);
    if (!store) return null;
    let requests = store.get(requestKey);
    if (!requests && create) {
      requests = new Map();
      store.set(requestKey, requests);
    }
    return requests || null;
  }

  let requests = runtime.blockStateRequests.get(overlay);
  if (!requests && create) {
    requests = new Map();
    runtime.blockStateRequests.set(overlay, requests);
  }
  return requests || null;
}

function pruneBlockPresentationRequests(runtime, blocks = []) {
  const store = runtime.blockStateRequests.get(runtime.dom.canvasStage);
  if (!store) return;
  const retainedKeys = new Set((blocks || [])
    .map((block) => blockPresentationRequestKey(runtime, block))
    .filter(Boolean));
  for (const requestKey of store.keys()) {
    if (!retainedKeys.has(requestKey)) store.delete(requestKey);
  }
}

function applyBlockPresentation(runtime, overlay, block = null) {
  const owner = blockPresentationOwners.get(overlay);
  const ownerIsCurrent = owner?.runtime === runtime
    && runtimeOperationIsCurrent(owner.operation);
  const ownedBlock = ownerIsCurrent ? (block || owner.block) : null;
  const requests = blockPresentationRequests(runtime, overlay, ownedBlock, { create: false });
  const state = currentBlockPresentationInteraction(
    runtime,
    ownedBlock,
    requests?.values() || []
  );
  overlay.dataset.state = String(state.presentationState);
  const hidden = state.presentationState === BLOCK_STATE.HIDDEN;
  const disabled = ownedBlock ? !state.interactive : hidden;
  overlay.disabled = disabled;
  overlay.tabIndex = disabled ? -1 : 0;
  overlay.setAttribute('aria-hidden', String(hidden));
  return state;
}

function setBlockState(runtime, overlay, source, state) {
  const owner = blockPresentationOwners.get(overlay);
  const block = owner?.runtime === runtime && runtimeOperationIsCurrent(owner.operation)
    ? owner.block
    : null;
  // `mode` is retained as a repaint trigger for the existing Highlight Edit
  // caller. Mode authority comes from the semantic derivation above, never
  // from a stored presentation request.
  if (source !== 'mode') {
    const requests = blockPresentationRequests(runtime, overlay, block);
    if (state === null) requests.delete(source);
    else requests.set(source, state);
  }
  return applyBlockPresentation(runtime, overlay, block);
}

function blockBaseState(runtime, block) {
  return currentBlockPresentationInteraction(runtime, block).presentationState;
}

function blockHoverState(runtime, block) {
  if (runtime.blockVisualMode === BLOCK_MODE.NORMAL) return BLOCK_STATE.ACTIVE;
  if (runtime.blockVisualMode === BLOCK_MODE.HIGHLIGHT_VIEW
    && runtime.activeHighlightBlockIds.has(block.id)) return BLOCK_STATE.ACTIVE;
  return null;
}

function blockActiveState(runtime, block) {
  if (runtime.blockVisualMode === BLOCK_MODE.NORMAL
    || runtime.blockVisualMode === BLOCK_MODE.BLOCK_EDIT) return BLOCK_STATE.ACTIVE;
  if (runtime.blockVisualMode === BLOCK_MODE.HIGHLIGHT_VIEW
    && runtime.activeHighlightBlockIds.has(block.id)) return BLOCK_STATE.ACTIVE;
  return null;
}

function blockOverlay(runtime, blockId) {
  return runtime.dom.canvasStage.querySelector(
    `.canvas-block-overlay[data-block-id="${CSS.escape(blockId)}"]`
  );
}

function blockIsInteractive(runtime, block) {
  return currentBlockPresentationInteraction(runtime, block).interactive;
}

function blockInteractionKind(runtime, block) {
  return currentBlockPresentationInteraction(runtime, block).interactionKind;
}

function pageCanvasIsVisible(runtime) {
  const { canvasArea, canvasStage } = runtime.dom;
  return Boolean(
    runtime.currentPage
    && canvasArea.isConnected
    && canvasArea.getClientRects().length
    && !canvasStage.hidden
    && runtime.canvasObjects.length
  );
}

function applyBlockElementGeometry(element, block, object) {
  element.style.left = `${block.x - object.x}px`;
  element.style.top = `${block.y - object.y}px`;
  element.style.width = `${block.width}px`;
  element.style.height = `${block.height}px`;
  element.style.transform = `rotate(${pageObjectsModel.normalizedRotation(block.rotation)}deg)`;
}

function appendBlockTransformControls(layer, block, object) {
  const controls = document.createElement('div');
  controls.className = 'canvas-block-transform-controls';
  controls.dataset.blockId = block.id;
  controls.setAttribute('aria-hidden', 'true');
  applyBlockElementGeometry(controls, block, object);
  for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    const element = document.createElement('span');
    element.className = `canvas-block-transform-handle is-${handle}`;
    element.dataset.blockResizeHandle = handle;
    controls.append(element);
  }
  const rotationHandle = document.createElement('span');
  rotationHandle.className = 'canvas-block-rotation-handle';
  rotationHandle.dataset.blockRotationHandle = 'true';
  controls.append(rotationHandle);
  layer.append(controls);
}

function renderBlockOverlays(runtime, blocks = []) {
  const { canvasStage } = runtime.dom;
  const presentationOperation = captureRuntimeOperation(runtime, {
    scope: 'block-presentation',
    pageId: runtime.currentPage?.id || null
  });
  for (const element of canvasStage.querySelectorAll(
    '.canvas-block-overlay, .canvas-block-transform-controls'
  )) {
    element.remove();
  }

  pruneBlockPresentationRequests(runtime, blocks);

  const objectIds = new Set(runtime.canvasObjects.map((object) => object.id));
  for (const block of blocks) {
    const hasValidGeometry = ['x', 'y', 'width', 'height']
      .every((field) => Number.isFinite(block[field]));
    if (!objectIds.has(block.objectId) || !hasValidGeometry
      || block.width <= 0 || block.height <= 0) continue;

    const links = typeof clickableBlockTargets === 'function'
      ? clickableBlockTargets(runtime, block)
      : pageLinks(block);
    const overlay = document.createElement('button');
    overlay.type = 'button';
    overlay.className = 'canvas-block-overlay';
    overlay.dataset.blockId = block.id;
    blockPresentationOwners.set(overlay, {
      runtime,
      operation: presentationOperation,
      block
    });
    applyBlockPresentation(runtime, overlay, block);
    setBlockState(
      runtime,
      overlay,
      'add-link',
      runtime.addLinkTarget?.blockId === block.id ? BLOCK_STATE.ACTIVE : null
    );
    overlay.setAttribute('aria-label', links.length === 1
      ? `${block.id}: open ${links[0].label || links[0].targetPageId || links[0].id}`
      : block.id);
    const object = runtime.canvasObjects.find((item) => item.id === block.objectId);
    const layer = object && canvasStage.querySelector(
      `.canvas-object-layer[data-object-id="${CSS.escape(block.objectId)}"]`
    );
    if (!object || !layer) continue;
    applyBlockElementGeometry(overlay, block, object);
    applyColourfulBlockStyle(overlay, block);
    overlay.addEventListener('click', (event) => {
      if (event.detail === 0 && runtimeOperationIsCurrent(presentationOperation)) {
        handleBlockClick(runtime, event, block);
      }
    });
    layer.append(overlay);
  }

  if (runtime.blockEditMode && runtime.selectedBlockId) {
    const selected = blocks.find((block) => block.id === runtime.selectedBlockId);
    const object = selected
      && runtime.canvasObjects.find((item) => item.id === selected.objectId);
    const layer = object && canvasStage.querySelector(
      `.canvas-object-layer[data-object-id="${CSS.escape(object.id)}"]`
    );
    if (selected && object && layer) appendBlockTransformControls(layer, selected, object);
  }
  renderHighlightMask(runtime, blocks);
  reconcileQuickColourBar(runtime);
}

function configureCanvasObjectLayer(runtime, layer, object) {
  layer.style.left = `${object.x}px`;
  layer.style.top = `${object.y}px`;
  layer.style.width = `${object.width}px`;
  layer.style.height = `${object.height}px`;
  layer.classList.toggle('is-selected', runtime.pageEditMode
    && pageTypeOwnsCanvasObjectEdits(runtime)
    && runtime.selectedPageObjectId === object.id);
}

function pageTypeOwnsCanvasObjectEdits(runtime, page = runtime.currentPage) {
  return Boolean(pageTypesModel?.pageTypeSupports?.(page?.type, 'canvas'));
}

function appendPageEditHandles(layer) {
  for (const handle of ['nw', 'ne', 'se', 'sw']) {
    const element = document.createElement('span');
    element.className = `canvas-object-resize-handle is-${handle}`;
    element.dataset.resizeHandle = handle;
    element.setAttribute('aria-hidden', 'true');
    layer.append(element);
  }
}

function highlightMaskableVisualRegions(runtime, objects = runtime.canvasObjects) {
  return (objects || [])
    .filter((object) => object.type === 'image'
      && isDisplayableObject(object) && isVisibleObject(object))
    .map((object) => ({
      id: object.id,
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height
    }));
}

function highlightMaskExclusionRegions(
  runtime,
  blocks = runtime.currentPage?.blocks || [],
  selectedBlockIds = runtime.activeHighlightBlockIds,
  additionalRegions = []
) {
  const selected = selectedBlockIds instanceof Set
    ? selectedBlockIds
    : new Set(selectedBlockIds || []);
  const objectIds = new Set(runtime.canvasObjects.map((object) => object.id));
  const selectedBlockRegions = (blocks || [])
    .filter((block) => selected.has(block.id)
      && objectIds.has(block.objectId)
      && ['x', 'y', 'width', 'height'].every((field) => Number.isFinite(block[field]))
      && block.width > 0 && block.height > 0)
    .map((block) => ({
      kind: 'polygon',
      id: block.id,
      points: pageObjectsModel.rotatedRectPolygon(block)
    }));
  return [...selectedBlockRegions, ...(additionalRegions || [])];
}

function removeHighlightMask(runtime) {
  runtime.dom.canvasStage.querySelector('.canvas-highlight-mask')?.remove();
  runtime.dom.canvasStage.classList.remove('has-highlight-mask');
}

function highlightMaskId(runtime) {
  const paneId = runtime.paneId || 'main';
  return `canvas-highlight-mask-${paneId.replace(/[^a-z0-9_-]/gi, '_')}`;
}

function renderHighlightMask(runtime, blocks = runtime.currentPage?.blocks || []) {
  const { canvasStage } = runtime.dom;
  if (runtime.blockVisualMode !== BLOCK_MODE.HIGHLIGHT_VIEW
    || !runtime.canvasObjects.length) {
    removeHighlightMask(runtime);
    return;
  }

  const maskableRegions = highlightMaskableVisualRegions(runtime);
  if (!maskableRegions.length) {
    removeHighlightMask(runtime);
    return;
  }
  const exclusionRegions = highlightMaskExclusionRegions(runtime, blocks);
  const bounds = getObjectBounds(maskableRegions);
  const signature = JSON.stringify({
    pageId: runtime.currentPage?.id || null,
    maskableRegions,
    exclusionRegions
  });
  const existing = canvasStage.querySelector('.canvas-highlight-mask');
  if (existing?.dataset.geometrySignature === signature) {
    canvasStage.classList.add('has-highlight-mask');
    return;
  }
  existing?.remove();

  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.classList.add('canvas-highlight-mask');
  svg.dataset.geometrySignature = signature;
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`);
  svg.style.left = `${bounds.minX}px`;
  svg.style.top = `${bounds.minY}px`;
  svg.style.width = `${bounds.width}px`;
  svg.style.height = `${bounds.height}px`;

  const definitions = document.createElementNS(namespace, 'defs');
  const mask = document.createElementNS(namespace, 'mask');
  const maskId = highlightMaskId(runtime);
  mask.id = maskId;
  mask.setAttribute('maskUnits', 'userSpaceOnUse');
  mask.setAttribute('x', String(bounds.minX));
  mask.setAttribute('y', String(bounds.minY));
  mask.setAttribute('width', String(bounds.width));
  mask.setAttribute('height', String(bounds.height));

  const clear = document.createElementNS(namespace, 'rect');
  clear.setAttribute('x', String(bounds.minX));
  clear.setAttribute('y', String(bounds.minY));
  clear.setAttribute('width', String(bounds.width));
  clear.setAttribute('height', String(bounds.height));
  clear.setAttribute('fill', 'black');
  mask.append(clear);
  for (const region of maskableRegions) {
    const rect = document.createElementNS(namespace, 'rect');
    rect.setAttribute('x', String(region.x));
    rect.setAttribute('y', String(region.y));
    rect.setAttribute('width', String(region.width));
    rect.setAttribute('height', String(region.height));
    rect.setAttribute('fill', 'white');
    mask.append(rect);
  }
  for (const region of exclusionRegions) {
    if (region.kind !== 'polygon' || !region.points?.length) continue;
    const polygon = document.createElementNS(namespace, 'polygon');
    polygon.setAttribute('points', region.points.map((point) => `${point.x},${point.y}`).join(' '));
    polygon.setAttribute('fill', 'black');
    mask.append(polygon);
  }
  definitions.append(mask);

  const fill = document.createElementNS(namespace, 'rect');
  fill.classList.add('canvas-highlight-mask-fill');
  fill.setAttribute('x', String(bounds.minX));
  fill.setAttribute('y', String(bounds.minY));
  fill.setAttribute('width', String(bounds.width));
  fill.setAttribute('height', String(bounds.height));
  fill.setAttribute('mask', `url(#${maskId})`);
  svg.append(definitions, fill);
  canvasStage.append(svg);
  canvasStage.classList.add('has-highlight-mask');
}

function renderCanvas(runtime, objects = [], blocks = [], { fit = true } = {}) {
  if (!runtimeIsLive(runtime)) return;
  const { canvasArea, canvasStage, emptyCanvas } = runtime.dom;
  runtime.canvasObjects = objects.filter(
    (object) => isDisplayableObject(object) && isVisibleObject(object)
  );
  const rendersMarkdown = typeof pageIsMarkdown === 'function'
    && pageIsMarkdown(runtime.currentPage);
  const rendersHnText = typeof pageIsHnText === 'function'
    && pageIsHnText(runtime.currentPage);
  const rendersStructuredText = rendersMarkdown || rendersHnText;
  if (!rendersStructuredText) disconnectStructuredTextViewport(runtime, canvasArea);
  resetCanvasImageSession(runtime, runtime.currentPage?.id || null);
  const renderOperation = captureRuntimeOperation(runtime, {
    scope: 'canvas-render',
    pageId: runtime.currentPage?.id || null,
    generation: runtime.canvasImageSessionGeneration
  });
  const frameBoundaryInteractionEnabled = () => (
    runtimeOperationIsCurrent(renderOperation)
      && runtime.pageEditMode
      && !runtime.pageEditSaveInProgress
  );
  const reusableImages = new Map(
    [...canvasStage.querySelectorAll('.canvas-object-image')]
      .filter((image) => image.dataset.canvasRuntimeId === runtime.runtimeId)
      .map((image) => [image.dataset.objectId, image])
  );
  if (typeof destroyMarkdownPageLayer === 'function') destroyMarkdownPageLayer(canvasStage);
  if (!rendersHnText && typeof destroyHnTextPageLayer === 'function') {
    destroyHnTextPageLayer(canvasStage);
  }
  canvasStage.replaceChildren();
  canvasStage.classList.remove('has-highlight-mask');
  canvasStage.hidden = runtime.canvasObjects.length === 0;
  emptyCanvas.hidden = runtime.canvasObjects.length > 0 || rendersStructuredText;
  if (!runtime.canvasObjects.length && !rendersStructuredText) {
    closeAddLinkPopover(runtime);
    closeQuickColourBar(runtime);
    runtime.canvasBounds = null;
    runtime.canvasView.scale = 1;
    runtime.canvasView.offsetX = 0;
    runtime.canvasView.offsetY = 0;
    applyCanvasTransform(runtime);
    return;
  }

  runtime.canvasBounds = runtime.canvasObjects.length
    ? getObjectBounds(runtime.canvasObjects)
    : null;

  for (const object of runtime.canvasObjects) {
    const layer = document.createElement('div');
    layer.className = 'canvas-object-layer';
    layer.dataset.objectId = object.id;
    configureCanvasObjectLayer(runtime, layer, object);
    const slot = document.createElement('div');
    slot.className = 'canvas-object-slot';
    slot.dataset.objectId = object.id;
    slot.setAttribute('aria-hidden', 'true');
    slot.style.inset = '0';
    const image = document.createElement('img');
    const state = canvasImageState(runtime, object);
    const reusableImage = reusableImages.get(object.id);
    const renderedImage = reusableImage || image;
    renderedImage.dataset.canvasRuntimeId = runtime.runtimeId;
    state.slotElement = slot;
    state.layerElement = layer;
    canvasStage.append(layer);
    if (desktopDisplayProxiesAvailable()) {
      state.imageElement = reusableImage || null;
      layer.append(slot);
      if (reusableImage) {
        configureCanvasImageElement(reusableImage, object);
        reusableImage.hidden = !state.currentTier;
        layer.append(reusableImage);
      }
    } else {
      configureCanvasImageElement(renderedImage, object);
      renderedImage.hidden = true;
      state.imageElement = renderedImage;
      renderedImage.src = cacheBustedSrc(runtime, object);
      if (!renderedImage.dataset.canvasLoadBound) {
        renderedImage.dataset.canvasLoadBound = 'true';
        renderedImage.addEventListener('load', () => {
          const liveObject = runtime.canvasObjects
            .find((item) => item.id === renderedImage.dataset.objectId);
          const liveState = liveObject
            && runtime.canvasImageVariantStates.get(liveObject.id);
          if (!runtimeIsLive(runtime) || !liveObject || !liveState
            || liveState.imageElement !== renderedImage) return;
          renderedImage.hidden = false;
          buildCanvasAlphaMask(
            liveObject,
            liveState,
            renderedImage,
            renderedImage.currentSrc || renderedImage.src
          );
        });
        renderedImage.addEventListener('error', () => {
          const liveState = runtime.canvasImageVariantStates
            .get(renderedImage.dataset.objectId);
          if (!runtimeIsLive(runtime) || liveState?.imageElement !== renderedImage) return;
          renderedImage.hidden = true;
        });
      }
      layer.append(slot, renderedImage);
    }
    if (runtime.pageEditMode && pageTypeOwnsCanvasObjectEdits(runtime)) {
      appendPageEditHandles(layer);
    }
  }

  renderBlockOverlays(runtime, blocks);

  if (rendersMarkdown && typeof renderMarkdownPageLayer === 'function') {
    const ownerStage = canvasStage;
    const ownerTab = runtime.session?.activeTab?.();
    const page = runtime.pageEditMode && runtime.draftPageTextFrame
      ? { ...runtime.currentPage, textFrame: { ...runtime.draftPageTextFrame } }
      : runtime.currentPage;
    renderMarkdownPageLayer({
      page,
      stage: canvasStage,
      area: canvasArea,
      paneId: runtime.paneId,
      tabId: ownerTab?.id,
      historyOwner: ownerTab,
      markdownStructuralFolds: Array.isArray(ownerTab?.viewState?.markdownStructuralFolds)
        ? ownerTab.viewState.markdownStructuralFolds.map((fold) => ({ ...fold }))
        : [],
      mode: vaultPreferences.lastMarkdownMode,
      zoom: runtime.canvasView.scale,
      cameraOffsetX: runtime.canvasView.offsetX,
      cameraOffsetY: runtime.canvasView.offsetY,
      pageEditMode: runtime.pageEditMode,
      frameBoundaryInteractionEnabled,
      bodyReadOnly: markdownPageMutationLocks.has(page.id),
      objectBounds: runtime.canvasBounds,
      onBodyInput: (detail) => updateMarkdownBodyFromView(runtime, detail),
      onBodyCommit: (detail) => updateMarkdownBodyFromView(runtime, detail),
      onTitleCommit: (detail) => saveMarkdownDocumentTitle(runtime, detail),
      onRecenter: (detail) => recenterMarkdownDocument(runtime, detail),
      onLinkActivate: (detail) => activateMarkdownLink(runtime, detail),
      onTextFrameInput: (frame, detail) => runtimeOperationIsCurrent(renderOperation)
        && updateDraftStructuredTextFrame(
          runtime, page.id, frame, detail, { commit: false }
        ),
      onTextFrameCommit: (frame, detail) => runtimeOperationIsCurrent(renderOperation)
        && updateDraftStructuredTextFrame(
          runtime, page.id, frame, detail, { commit: true }
        ),
      onFoldStateChange: (detail) => {
        if (!runtimeOperationIsCurrent(renderOperation)) return;
        const liveTab = runtime.session?.tabById?.(ownerTab?.id);
        if (!liveTab || liveTab.currentPageId !== page.id) return;
        const folds = Array.isArray(detail?.folds)
          ? detail.folds.map((fold) => ({ ...fold }))
          : [];
        runtime.session.saveViewState(liveTab.id, {
          ...liveTab.viewState,
          markdownStructuralFolds: folds
        });
        if (typeof scheduleWorkspaceStateSave === 'function') scheduleWorkspaceStateSave();
      },
      onDocumentExtentChange: () => {
        if (runtimeOperationIsCurrent(renderOperation)) {
          refreshPaneMarkdownWorldBounds(runtime, ownerStage);
        }
      }
    });
    const markdownBounds = getMarkdownDocumentBounds(canvasStage);
    if (markdownBounds) {
      if (runtime.canvasBounds) {
        const minX = Math.min(runtime.canvasBounds.minX, markdownBounds.left);
        const minY = Math.min(runtime.canvasBounds.minY, markdownBounds.top);
        const maxX = Math.max(runtime.canvasBounds.maxX, markdownBounds.right);
        const maxY = Math.max(runtime.canvasBounds.maxY, markdownBounds.bottom);
        runtime.canvasBounds = {
          minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY
        };
      } else {
        runtime.canvasBounds = {
          minX: markdownBounds.left,
          minY: markdownBounds.top,
          maxX: markdownBounds.right,
          maxY: markdownBounds.bottom,
          width: markdownBounds.width,
          height: markdownBounds.height
        };
      }
    }
  }

  if (rendersHnText && typeof renderHnTextPageLayer === 'function') {
    const ownerStage = canvasStage;
    const ownerTab = runtime.session?.activeTab?.();
    const session = typeof getHnPageDocumentSession === 'function'
      ? getHnPageDocumentSession(runtime.currentPage, runtime, ownerTab)
      : null;
    const page = runtime.pageEditMode && runtime.draftPageTextFrame
      ? { ...runtime.currentPage, textFrame: { ...runtime.draftPageTextFrame } }
      : runtime.currentPage;
    renderHnTextPageLayer({
      page,
      stage: ownerStage,
      area: canvasArea,
      paneId: runtime.paneId,
      tabId: ownerTab?.id,
      zoom: runtime.canvasView.scale,
      cameraOffsetX: runtime.canvasView.offsetX,
      cameraOffsetY: runtime.canvasView.offsetY,
      objectBounds: runtime.canvasBounds,
      pageEditMode: runtime.pageEditMode,
      frameBoundaryInteractionEnabled,
      mode: hnTextModel.normalizeHnTextMode(vaultPreferences.cneTextMode),
      session,
      onTitleCommit: (detail) => saveMarkdownDocumentTitle(runtime, detail),
      onTextFrameInput: (frame, detail) => runtimeOperationIsCurrent(renderOperation)
        && updateDraftStructuredTextFrame(
          runtime, page.id, frame, detail, { commit: false }
        ),
      onTextFrameCommit: (frame, detail) => runtimeOperationIsCurrent(renderOperation)
        && updateDraftStructuredTextFrame(
          runtime, page.id, frame, detail, { commit: true }
        ),
      onDocumentState: (snapshot) => {
        if (runtimeOperationIsCurrent(renderOperation) && runtime === activePaneRuntime()) {
          refreshHnTextControlStrip(runtime, snapshot);
        }
      },
      onDocumentExtentChange: () => {
        if (runtimeOperationIsCurrent(renderOperation)) {
          refreshPaneStructuredTextWorldBounds(runtime, ownerStage);
        }
      }
    });
    const hnBounds = getHnTextDocumentBounds(ownerStage);
    if (hnBounds) {
      if (runtime.canvasBounds) {
        const minX = Math.min(runtime.canvasBounds.minX, hnBounds.left);
        const minY = Math.min(runtime.canvasBounds.minY, hnBounds.top);
        const maxX = Math.max(runtime.canvasBounds.maxX, hnBounds.right);
        const maxY = Math.max(runtime.canvasBounds.maxY, hnBounds.bottom);
        runtime.canvasBounds = {
          minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY
        };
      } else {
        runtime.canvasBounds = {
          minX: hnBounds.left,
          minY: hnBounds.top,
          maxX: hnBounds.right,
          maxY: hnBounds.bottom,
          width: hnBounds.width,
          height: hnBounds.height
        };
      }
    }
  }

  canvasStage.style.width = `${Math.max(
    1,
    runtime.canvasBounds?.maxX || runtime.canvasBounds?.width || 1
  )}px`;
  canvasStage.style.height = `${Math.max(
    1,
    runtime.canvasBounds?.maxY || runtime.canvasBounds?.height || 1
  )}px`;

  if (fit && rendersStructuredText) {
    fitStructuredTextCameraToFrame(runtime.currentPage.textFrame, canvasArea, runtime.canvasView);
    applyCanvasTransform(runtime);
  } else if (fit) fitCanvasToObjects(runtime, runtime.canvasObjects);
  else applyCanvasTransform(runtime);
  if (rendersStructuredText) {
    observeStructuredTextViewport(runtime, {
      stage: canvasStage,
      area: canvasArea,
      page: runtime.currentPage
    });
  }
  checkCanvasImageResolutions(runtime, { validateSource: true });
}

function screenToWorld(runtime, clientX, clientY) {
  const viewport = runtime.dom.canvasArea.getBoundingClientRect();
  return {
    x: (clientX - viewport.left - runtime.canvasView.offsetX) / runtime.canvasView.scale,
    y: (clientY - viewport.top - runtime.canvasView.offsetY) / runtime.canvasView.scale
  };
}

function canvasInteractionBlocks(runtime) {
  if (runtime.pageEditMode) return [];
  if (runtime.blockEditMode) return runtime.draftBlocks;
  return runtime.currentPage?.blocks || [];
}

function resolveCanvasPointer(
  runtime,
  clientX,
  clientY,
  blocks = canvasInteractionBlocks(runtime)
) {
  return pageObjectsModel.resolveOrdinaryBlockTarget(
    runtime.canvasObjects,
    blocks,
    screenToWorld(runtime, clientX, clientY),
    (object, localPoint) => canvasObjectOpaqueAt(runtime, object, localPoint),
    (block) => blockIsInteractive(runtime, block)
  );
}

function resolveEditableBlockPointer(runtime, clientX, clientY) {
  return pageObjectsModel.resolveEditableBlockTarget(
    runtime.canvasObjects,
    runtime.draftBlocks,
    screenToWorld(runtime, clientX, clientY)
  );
}

function setSelectedBlock(runtime, blockId) {
  const nextSelectedBlockId = runtime.draftBlocks.some((block) => block.id === blockId)
    ? blockId
    : null;
  const quickColour = quickColourState(runtime);
  if (quickColour.blockId && nextSelectedBlockId !== quickColour.blockId) {
    closeQuickColourBar(runtime);
  }
  runtime.selectedBlockId = nextSelectedBlockId;
  clearCanvasPointerHover(runtime);
  renderBlockOverlays(runtime, runtime.draftBlocks);
}

function clearCanvasPointerHover(runtime) {
  if (typeof hideTemporaryBlockInfo === 'function') hideTemporaryBlockInfo(runtime);
  if (!runtime.hoveredCanvasBlockId) return;
  const overlay = blockOverlay(runtime, runtime.hoveredCanvasBlockId);
  if (overlay) {
    setBlockState(runtime, overlay, 'hover', null);
    setBlockState(runtime, overlay, 'active', null);
  }
  runtime.hoveredCanvasBlockId = null;
}

function handleCanvasTargetPointerMove(runtime, event) {
  if (markdownOwnsPointerEvent(runtime, event)) {
    clearCanvasPointerHover(runtime);
    return;
  }
  if (runtime.pageEditMode || runtime.blockVisualMode === BLOCK_MODE.HIGHLIGHT_EDIT
    || runtime.blockDrawing || runtime.blockTransform || runtime.pageObjectDrag) {
    clearCanvasPointerHover(runtime);
    return;
  }
  if (typeof pointerIsOverTemporaryInfoPanel === 'function'
    && pointerIsOverTemporaryInfoPanel(runtime, event.clientX, event.clientY)) {
    return;
  }
  const target = resolveCanvasPointer(runtime, event.clientX, event.clientY);
  const nextId = target.block?.id || null;
  if (nextId === runtime.hoveredCanvasBlockId) return;
  clearCanvasPointerHover(runtime);
  if (!nextId) return;
  runtime.hoveredCanvasBlockId = nextId;
  const overlay = blockOverlay(runtime, nextId);
  if (overlay) {
    setBlockState(runtime, overlay, 'hover', blockHoverState(runtime, target.block));
  }
  if (typeof showTemporaryBlockInfo === 'function') {
    showTemporaryBlockInfo(runtime, target.block);
  }
}

function handleCanvasTargetPointerDown(runtime, event) {
  if (markdownOwnsPointerEvent(runtime, event)) return;
  if (runtime.pageEditMode || runtime.blockEditMode
    || runtime.blockVisualMode === BLOCK_MODE.HIGHLIGHT_EDIT
    || event.button !== 0) return;
  const target = resolveCanvasPointer(runtime, event.clientX, event.clientY);
  if (!target.block) return;
  const overlay = blockOverlay(runtime, target.block.id);
  if (overlay) {
    setBlockState(runtime, overlay, 'active', blockActiveState(runtime, target.block));
  }
}

function handleCanvasTargetPointerUp(runtime, event) {
  if (markdownOwnsPointerEvent(runtime, event)) return;
  if (runtime.pageEditMode || runtime.blockEditMode
    || runtime.blockVisualMode === BLOCK_MODE.HIGHLIGHT_EDIT
    || event.button !== 0) return;
  const target = resolveCanvasPointer(runtime, event.clientX, event.clientY);
  const overlay = target.block && blockOverlay(runtime, target.block.id);
  if (overlay) setBlockState(runtime, overlay, 'active', null);
}

function handleCanvasTargetClick(runtime, event) {
  if (markdownOwnsPointerEvent(runtime, event)) return;
  if (runtime.pageEditMode || runtime.blockEditMode || event.button !== 0) return;
  const target = resolveCanvasPointer(runtime, event.clientX, event.clientY);
  if (!target.block) return;
  const interactionKind = blockInteractionKind(runtime, target.block);
  if (interactionKind === BLOCK_INTERACTION_KIND.EDIT_HIGHLIGHT_MEMBERSHIP) {
    event.preventDefault();
    event.stopPropagation();
    toggleHighlightEditBlock(runtime, target.block.id);
    return;
  }
  if (interactionKind !== BLOCK_INTERACTION_KIND.ACTIVATE_TARGET) return;
  if (event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof openBlockInfoEditor === 'function') {
      openBlockInfoEditor(runtime, target.block.id);
    }
    return;
  }
  const overlay = blockOverlay(runtime, target.block.id);
  handleBlockClick(runtime, {
    currentTarget: overlay,
    preventDefault: () => event.preventDefault(),
    stopPropagation: () => event.stopPropagation()
  }, target.block);
}

function handleCanvasTargetContextMenu(runtime, event) {
  if (markdownOwnsPointerEvent(runtime, event)) return;
  if (runtime.blockVisualMode === BLOCK_MODE.HIGHLIGHT_EDIT) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (runtime.pageEditMode) {
    handlePageObjectContextMenu(runtime, event);
    return;
  }
  const target = runtime.blockEditMode
    ? resolveEditableBlockPointer(runtime, event.clientX, event.clientY)
    : resolveCanvasPointer(runtime, event.clientX, event.clientY);
  if (!target.block) return;
  handleBlockContextMenu(runtime, {
    currentTarget: blockOverlay(runtime, target.block.id),
    preventDefault: () => event.preventDefault(),
    stopPropagation: () => event.stopPropagation()
  }, target.block.id);
}

function normalizedBlockGeometry(start, end) {
  const round = (value) => Math.round(value * 100) / 100;
  return {
    x: round(Math.min(start.x, end.x)),
    y: round(Math.min(start.y, end.y)),
    width: round(Math.abs(end.x - start.x)),
    height: round(Math.abs(end.y - start.y))
  };
}

function nextBlockId(runtime) {
  const pageCode = runtime.currentPage.code
    || runtime.currentPage.id.replace(/^page_/, '');
  const prefix = `block_${pageCode}_`;
  const usedIds = new Set(runtime.draftBlocks.map((block) => block.id));
  let number = runtime.draftBlocks.reduce((highest, block) => {
    if (!block.id.startsWith(prefix)) return highest;
    const parsed = Number.parseInt(block.id.slice(prefix.length), 10);
    return Number.isFinite(parsed) ? Math.max(highest, parsed) : highest;
  }, 0) + 1;

  while (usedIds.has(`${prefix}${String(number).padStart(3, '0')}`)) number += 1;
  return `${prefix}${String(number).padStart(3, '0')}`;
}

function updateBlockPreview(runtime, geometry) {
  if (!runtime.blockPreview) {
    runtime.blockPreview = document.createElement('div');
    runtime.blockPreview.className = 'canvas-block-overlay';
    runtime.blockPreview.setAttribute('aria-hidden', 'true');
    setBlockState(runtime, runtime.blockPreview, 'drawing', BLOCK_STATE.ACTIVE);
    runtime.dom.canvasStage.append(runtime.blockPreview);
  }

  runtime.blockPreview.style.left = `${geometry.x}px`;
  runtime.blockPreview.style.top = `${geometry.y}px`;
  runtime.blockPreview.style.width = `${geometry.width}px`;
  runtime.blockPreview.style.height = `${geometry.height}px`;
  applyColourfulBlockStyle(runtime.blockPreview, runtime.blockDrawing);
}

function clearBlockDrawing(runtime) {
  runtime.blockPreview?.remove();
  runtime.blockPreview = null;
  runtime.blockDrawing = null;
}

function suppressQuickColourBarForTransform(runtime, transform = runtime.blockTransform) {
  if (!transform || transform.quickColourSuppressed) return;
  transform.quickColourSuppressed = true;
  closeQuickColourBar(runtime);
}

function beginBlockTransform(runtime, event, block, type, handle = null) {
  const point = screenToWorld(runtime, event.clientX, event.clientY);
  const centre = { x: block.x + block.width / 2, y: block.y + block.height / 2 };
  runtime.dom.canvasArea.setPointerCapture(event.pointerId);
  runtime.blockTransform = {
    operation: captureRuntimeOperation(runtime, {
      scope: 'block-transform',
      pageId: runtime.currentPage?.id || null,
      pointerId: event.pointerId
    }),
    pointerId: event.pointerId,
    blockId: block.id,
    type,
    handle,
    startBlock: { ...block },
    beforeBlocks: cloneBlocks(runtime.draftBlocks),
    startPoint: point,
    startClient: { x: event.clientX, y: event.clientY },
    started: type !== 'move',
    quickColourSuppressed: false,
    lastAngle: Math.atan2(point.y - centre.y, point.x - centre.x),
    rotation: pageObjectsModel.normalizedRotation(block.rotation)
  };
  if (type !== 'move') suppressQuickColourBarForTransform(runtime, runtime.blockTransform);
}

function updateTransformedBlock(runtime, blockId, geometry) {
  const block = runtime.draftBlocks.find((item) => item.id === blockId);
  if (!block) return;
  const round = (value) => Math.round(value * 100) / 100;
  Object.assign(block, {
    x: round(geometry.x),
    y: round(geometry.y),
    width: round(geometry.width),
    height: round(geometry.height),
    rotation: round(pageObjectsModel.normalizedRotation(geometry.rotation))
  });
  renderBlockOverlays(runtime, runtime.draftBlocks);
}

function updateBlockTransform(runtime, event) {
  const transform = runtime.blockTransform;
  if (!transform || !runtimeOperationIsCurrent(transform.operation)
    || event.pointerId !== transform.pointerId) return false;
  event.preventDefault();
  const point = screenToWorld(runtime, event.clientX, event.clientY);
  if (transform.type === 'resize') {
    updateTransformedBlock(runtime, transform.blockId, pageObjectsModel.resizeRotatedBlock(
      transform.startBlock,
      transform.handle,
      point,
      MIN_BLOCK_SIZE
    ));
    return true;
  }
  if (transform.type === 'move') {
    if (!transform.started) {
      const clientDistance = Math.hypot(
        event.clientX - transform.startClient.x,
        event.clientY - transform.startClient.y
      );
      if (clientDistance < BLOCK_MOVE_THRESHOLD) return true;
      transform.started = true;
      suppressQuickColourBarForTransform(runtime, transform);
    }
    updateTransformedBlock(runtime, transform.blockId, {
      ...transform.startBlock,
      x: transform.startBlock.x + point.x - transform.startPoint.x,
      y: transform.startBlock.y + point.y - transform.startPoint.y
    });
    return true;
  }
  const start = transform.startBlock;
  const centre = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  const angle = Math.atan2(point.y - centre.y, point.x - centre.x);
  let delta = angle - transform.lastAngle;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  transform.lastAngle = angle;
  transform.rotation += delta * 180 / Math.PI;
  updateTransformedBlock(runtime, transform.blockId, {
    ...start,
    rotation: transform.rotation
  });
  return true;
}

function finishBlockTransform(runtime, event, shouldCommit = true) {
  const transform = runtime.blockTransform;
  if (!transform || !runtimeOperationIsCurrent(transform.operation)
    || event.pointerId !== transform.pointerId) return;
  event.preventDefault();
  if (runtime.dom.canvasArea.hasPointerCapture(event.pointerId)) {
    runtime.dom.canvasArea.releasePointerCapture(event.pointerId);
  }
  const completed = transform;
  runtime.blockTransform = null;
  if (!shouldCommit) {
    applyDraftBlockSnapshot(runtime, completed.beforeBlocks, completed.blockId);
    return;
  }
  recordDraftBlockChange(runtime, completed.beforeBlocks, runtime.draftBlocks, {
    undoSelection: completed.blockId,
    redoSelection: completed.blockId
  });
  reconcileQuickColourBar(runtime, { rebuild: completed.quickColourSuppressed });
}

function handleBlockPointerDown(runtime, event) {
  if (markdownOwnsPointerEvent(runtime, event)) return;
  if (!runtime.blockEditMode || runtime.pageEditMode || runtime.blockSaveInProgress
    || !runtime.canvasObjects.length || event.button !== 0) return;
  event.preventDefault();
  const rotationHandle = event.target.closest?.('[data-block-rotation-handle]');
  if (rotationHandle) {
    const controls = event.target.closest?.('.canvas-block-transform-controls');
    const block = runtime.draftBlocks.find((item) => item.id === controls?.dataset.blockId);
    if (!block || block.id !== runtime.selectedBlockId) return;
    beginBlockTransform(runtime, event, block, 'rotate');
    return;
  }
  const resizeHandle = event.target.closest?.('[data-block-resize-handle]');
  if (resizeHandle) {
    const controls = event.target.closest?.('.canvas-block-transform-controls');
    const block = runtime.draftBlocks.find((item) => item.id === controls?.dataset.blockId);
    if (!block || block.id !== runtime.selectedBlockId) return;
    beginBlockTransform(
      runtime,
      event,
      block,
      'resize',
      resizeHandle.dataset.blockResizeHandle
    );
    return;
  }
  const point = screenToWorld(runtime, event.clientX, event.clientY);
  const target = pageObjectsModel.resolveEditableBlockTarget(
    runtime.canvasObjects,
    runtime.draftBlocks,
    point
  );
  if (target.block) {
    if (blockInteractionKind(runtime, target.block)
      !== BLOCK_INTERACTION_KIND.SELECT_BLOCK_EDIT) return;
    setSelectedBlock(runtime, target.block.id);
    beginBlockTransform(runtime, event, target.block, 'move');
    return;
  }
  setSelectedBlock(runtime, null);
  if (!target.object) return;
  runtime.dom.canvasArea.setPointerCapture(event.pointerId);
  const blockAppearance = normalizedCanvasBlockAppearance();
  const palette = quickColourPaletteSnapshot();
  const lastUsedColour = appearanceSettingsModel.normalizeHexColour(palette.lastUsedColour)
    || blockAppearance.colourfulBlock.lastUsedColour;
  runtime.blockDrawing = {
    operation: captureRuntimeOperation(runtime, {
      scope: 'block-drawing',
      pageId: runtime.currentPage?.id || null,
      pointerId: event.pointerId
    }),
    pointerId: event.pointerId,
    start: point,
    objectId: target.object.id,
    ...(palette.colourful
      ? { colour: lastUsedColour }
      : {})
  };
  updateBlockPreview(runtime, normalizedBlockGeometry(point, point));
}

function handleBlockPointerMove(runtime, event) {
  if (updateBlockTransform(runtime, event)) return;
  const drawing = runtime.blockDrawing;
  if (!drawing || !runtimeOperationIsCurrent(drawing.operation)
    || event.pointerId !== drawing.pointerId) return;
  event.preventDefault();
  updateBlockPreview(runtime, normalizedBlockGeometry(
    drawing.start,
    screenToWorld(runtime, event.clientX, event.clientY)
  ));
}

function finishBlockDrawing(runtime, event, shouldCommit) {
  const drawing = runtime.blockDrawing;
  if (!drawing || !runtimeOperationIsCurrent(drawing.operation)
    || event.pointerId !== drawing.pointerId) return;
  event.preventDefault();
  const geometry = normalizedBlockGeometry(
    drawing.start,
    screenToWorld(runtime, event.clientX, event.clientY)
  );
  const objectId = drawing.objectId;
  const colour = appearanceSettingsModel.normalizeHexColour(drawing.colour);

  if (runtime.dom.canvasArea.hasPointerCapture(event.pointerId)) {
    runtime.dom.canvasArea.releasePointerCapture(event.pointerId);
  }
  clearBlockDrawing(runtime);

  if (shouldCommit && geometry.width >= MIN_BLOCK_SIZE && geometry.height >= MIN_BLOCK_SIZE) {
    const beforeBlocks = cloneBlocks(runtime.draftBlocks);
    const block = {
      id: nextBlockId(runtime),
      objectId,
      ...geometry,
      rotation: 0,
      links: [],
      ...(colour ? { colour } : {})
    };
    runtime.draftBlocks.push(block);
    runtime.selectedBlockId = block.id;
    recordDraftBlockChange(runtime, beforeBlocks, runtime.draftBlocks, {
      undoSelection: null,
      redoSelection: block.id
    });
  }

  renderBlockOverlays(runtime, runtime.draftBlocks);
}

function applyBlockLayerCommand(runtime, blockId, command) {
  const beforeBlocks = cloneBlocks(runtime.draftBlocks);
  const next = pageObjectsModel.reorderBlocks(runtime.draftBlocks, blockId, command);
  if (next.every((block, index) => block.id === runtime.draftBlocks[index]?.id)) return;
  runtime.draftBlocks = next;
  setSelectedBlock(runtime, blockId);
  recordDraftBlockChange(runtime, beforeBlocks, runtime.draftBlocks, {
    undoSelection: blockId,
    redoSelection: blockId
  });
}

function zoomAtPoint(runtime, clientX, clientY, nextScale) {
  if (!pageWorldIsRenderable(runtime)) return;

  const viewport = runtime.dom.canvasArea.getBoundingClientRect();
  const pointX = clientX - viewport.left;
  const pointY = clientY - viewport.top;
  const worldX = (pointX - runtime.canvasView.offsetX) / runtime.canvasView.scale;
  const worldY = (pointY - runtime.canvasView.offsetY) / runtime.canvasView.scale;

  runtime.canvasView.scale = clampCanvasScale(nextScale);
  runtime.canvasView.offsetX = pointX - worldX * runtime.canvasView.scale;
  runtime.canvasView.offsetY = pointY - worldY * runtime.canvasView.scale;
  applyCanvasTransform(runtime);
  scheduleCanvasImageResolutionCheck(runtime);
}

function handleCanvasWheel(runtime, event) {
  if (!pageWorldIsRenderable(runtime)) return;
  event.preventDefault();

  const deltaUnit = event.deltaMode === 1
    ? 16
    : event.deltaMode === 2 ? runtime.dom.canvasArea.clientHeight : 1;

  if (event.ctrlKey || event.metaKey) {
    const zoomFactor = zoomControls.wheelZoomFactor(
      event.deltaY,
      deltaUnit,
      zoomSensitivity
    );
    zoomAtPoint(
      runtime,
      event.clientX,
      event.clientY,
      runtime.canvasView.scale * zoomFactor
    );
    return;
  }

  const markdownTarget = typeof markdownPageOwnsPointer === 'function'
    && markdownPageOwnsPointer(event.target);
  const hnTextTarget = typeof hnTextPageOwnsPointer === 'function'
    && hnTextPageOwnsPointer(event.target);
  const mostlyVertical = (markdownTarget || hnTextTarget)
    && Math.abs(event.deltaY) > Math.abs(event.deltaX) * 1.35;
  runtime.canvasView.offsetX -= (mostlyVertical ? 0 : event.deltaX) * deltaUnit;
  runtime.canvasView.offsetY -= event.deltaY * deltaUnit;
  applyCanvasTransform(runtime);
}


function setBlockEditMode(runtime, active) {
  const wasActive = runtime.blockEditMode;
  const { canvasArea, editBlockButton } = runtime.dom;
  if (!active) closeQuickColourBar(runtime);
  if (active && !wasActive && typeof suspendInfoPanelsForRuntime === 'function') {
    suspendInfoPanelsForRuntime(runtime);
  }
  setEditMenuOpen(runtime, false);
  setHighlightMenuOpen(runtime, false);
  runtime.blockEditMode = active;
  runtime.blockVisualMode = active ? BLOCK_MODE.BLOCK_EDIT : BLOCK_MODE.NORMAL;
  canvasArea.classList.toggle('block-edit-mode', active);
  editBlockButton.classList.toggle('is-active', active);
  editBlockButton.textContent = active ? '✓' : '✎';
  editBlockButton.setAttribute('aria-label', active ? 'Save blocks' : 'Open edit menu');
  editBlockButton.title = active ? 'Save blocks' : 'Edit';
  if (active) editBlockButton.disabled = false;
  else {
    updateEditAvailability(runtime);
    if (typeof prepareActiveTabHighlightState === 'function') {
      prepareActiveTabHighlightState(runtime);
    }
  }
  if (typeof updatePaneToolbarPresentation === 'function') {
    updatePaneToolbarPresentation(getWorkspacePane(runtime.paneId));
  }
  if (!active && wasActive && typeof resumeInfoPanelsForRuntime === 'function') {
    resumeInfoPanelsForRuntime(runtime);
  }
}

function enterBlockEditMode(runtime) {
  const mainImage = (runtime.currentPage?.objects || [])
    .find((object) => isDisplayableObject(object) && isVisibleObject(object));
  if (!mainImage || runtime.blockEditMode || runtime.highlightEditDraft) return;

  closeQuickColourBar(runtime);
  closeAddLinkPopover(runtime);
  runtime.originalBlocks = cloneBlocks(runtime.currentPage.blocks);
  runtime.draftBlocks = cloneBlocks(runtime.currentPage.blocks);
  runtime.selectedBlockId = null;
  runtime.blockTransform = null;
  beginCanvasUndoContext(runtime, 'block-edit');
  setBlockEditMode(runtime, true);
  renderBlockOverlays(runtime, runtime.draftBlocks);
  showRuntimeStatus(runtime, '');
}

function cancelBlockEdits(runtime) {
  if (!runtime.blockEditMode) return;
  if (runtime.blockTransform
    && runtime.dom.canvasArea.hasPointerCapture(runtime.blockTransform.pointerId)) {
    runtime.dom.canvasArea.releasePointerCapture(runtime.blockTransform.pointerId);
  }
  runtime.blockTransform = null;
  runtime.selectedBlockId = null;
  clearBlockDrawing(runtime);
  runtime.currentPage.blocks = cloneBlocks(runtime.originalBlocks);
  runtime.draftBlocks = [];
  clearCanvasUndoContext(runtime);
  setBlockEditMode(runtime, false);
  renderBlockOverlays(runtime, runtime.currentPage.blocks);
  renderRelations(runtime, runtime.currentPage);
  showRuntimeStatus(runtime, '');
}

async function saveBlockEdits(runtime) {
  if (!runtime.blockEditMode || runtime.blockSaveInProgress) return;
  closeQuickColourBar(runtime);
  if (runtime.blockTransform
    && runtime.dom.canvasArea.hasPointerCapture(runtime.blockTransform.pointerId)) {
    runtime.dom.canvasArea.releasePointerCapture(runtime.blockTransform.pointerId);
  }
  runtime.blockTransform = null;
  clearBlockDrawing(runtime);
  runtime.blockSaveInProgress = true;
  runtime.dom.editBlockButton.disabled = true;
  showRuntimeStatus(runtime, 'Saving…');
  const operation = captureRuntimeOperation(runtime, {
    scope: 'block-save',
    pageId: runtime.currentPage?.id || null
  });

  try {
    const savedPage = await request(pageApiUrl(operation.pageId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks: runtime.draftBlocks })
    });

    pageIndex = await request('/api/page-index');
    const operationIsCurrent = runtimeOperationIsCurrent(operation);
    const canonical = commitCanonicalPage(savedPage, {
      originRuntime: operationIsCurrent ? runtime : null
    });
    renderPageList();
    if (!operationIsCurrent) return;
    runtime.currentPageEntry = pageIndex.pages.find((page) => page.id === canonical.id);
    runtime.currentPage = canonical;
    runtime.originalBlocks = cloneBlocks(savedPage.blocks);
    runtime.draftBlocks = [];
    runtime.selectedBlockId = null;
    runtime.blockTransform = null;
    clearBlockDrawing(runtime);
    clearCanvasUndoContext(runtime, { commit: true });
    setBlockEditMode(runtime, false);
    renderBlockOverlays(runtime, savedPage.blocks);
    renderRelations(runtime, savedPage);
    showRuntimeStatus(runtime, 'Saved', false, 1800);
  } catch (error) {
    if (runtimeOperationIsCurrent(operation)) {
      showRuntimeStatus(runtime, error.message, true);
    }
  } finally {
    if (runtimeOperationOwnerIsCurrent(operation)) {
      runtime.blockSaveInProgress = false;
      updateEditAvailability(runtime);
    }
  }
}

function setPageEditMode(runtime, active) {
  const wasActive = runtime.pageEditMode;
  const { canvasArea, editBlockButton } = runtime.dom;
  if (active) closeQuickColourBar(runtime);
  if (active && !wasActive && typeof suspendInfoPanelsForRuntime === 'function') {
    suspendInfoPanelsForRuntime(runtime);
  }
  setEditMenuOpen(runtime, false);
  setHighlightMenuOpen(runtime, false);
  runtime.pageEditMode = active;
  canvasArea.classList.toggle('page-edit-mode', active);
  editBlockButton.classList.toggle('is-active', active);
  editBlockButton.textContent = active ? '✓' : '✎';
  editBlockButton.setAttribute('aria-label', active ? 'Save page layout' : 'Open edit menu');
  editBlockButton.title = active ? 'Save page layout' : 'Edit';
  if (active) editBlockButton.disabled = false;
  else {
    updateEditAvailability(runtime);
    if (typeof prepareActiveTabHighlightState === 'function') {
      prepareActiveTabHighlightState(runtime);
    }
  }
  if (typeof updatePaneToolbarPresentation === 'function') {
    updatePaneToolbarPresentation(getWorkspacePane(runtime.paneId));
  }
  if (!active && wasActive && typeof resumeInfoPanelsForRuntime === 'function') {
    resumeInfoPanelsForRuntime(runtime);
  }
}

function setSelectedPageObject(runtime, objectId) {
  runtime.selectedPageObjectId = pageTypeOwnsCanvasObjectEdits(runtime)
    && runtime.draftPageObjects.some((object) => object.id === objectId)
    ? objectId
    : null;
  for (const layer of runtime.dom.canvasStage.querySelectorAll('.canvas-object-layer')) {
    layer.classList.toggle(
      'is-selected',
      layer.dataset.objectId === runtime.selectedPageObjectId
    );
  }
}

function clonePageEditSnapshot(
  runtime,
  objects = runtime.draftPageObjects,
  blocks = runtime.draftPageBlocks
) {
  return {
    objects: pageObjectsModel.cloneObjects(objects),
    blocks: pageObjectsModel.cloneBlocks(blocks),
    textFrame: runtime.draftPageTextFrame ? { ...runtime.draftPageTextFrame } : null
  };
}

function applyPageEditSnapshot(runtime, snapshot, selectionId = null) {
  runtime.draftPageObjects = pageObjectsModel.cloneObjects(snapshot.objects);
  runtime.draftPageBlocks = pageObjectsModel.cloneBlocks(snapshot.blocks);
  runtime.draftPageTextFrame = snapshot.textFrame ? { ...snapshot.textFrame } : null;
  renderCanvas(runtime, runtime.draftPageObjects, [], { fit: false });
  setSelectedPageObject(runtime, selectionId);
}

function recordPageEditChange(runtime, before, after, {
  undoSelection = null,
  redoSelection = null
} = {}) {
  if (!runtimeOwnsCanvasUndoContext(runtime)
    || transactionalValuesEqual(before, after)) return false;
  const snapshotFrom = (value) => ({
    objects: pageObjectsModel.cloneObjects(value.objects),
    blocks: pageObjectsModel.cloneBlocks(value.blocks),
    textFrame: value.textFrame ? { ...value.textFrame } : null
  });
  const undoSnapshot = snapshotFrom(before);
  const redoSnapshot = snapshotFrom(after);
  return undoManager.record({
    undo: () => {
      if (runtimeIsLive(runtime) && runtimeOwnsCanvasUndoContext(runtime)) {
        applyPageEditSnapshot(runtime, undoSnapshot, undoSelection);
      }
    },
    redo: () => {
      if (runtimeIsLive(runtime) && runtimeOwnsCanvasUndoContext(runtime)) {
        applyPageEditSnapshot(runtime, redoSnapshot, redoSelection);
      }
    }
  });
}

function updateDraftStructuredTextFrame(
  runtime,
  pageId,
  frame,
  detail,
  { commit = false } = {}
) {
  const settlesPendingSave = detail?.settlement === 'page-edit-save';
  if (!runtimeIsLive(runtime) || !runtime.pageEditMode
    || (runtime.pageEditSaveInProgress && !settlesPendingSave)
    || runtime.currentPage?.id !== pageId
    || !globalThis.structuredTextFrameModel) return false;
  const model = globalThis.structuredTextFrameModel;
  const nextFrame = model.normalizeTextFrame(frame);
  if (!commit) {
    runtime.draftPageTextFrame = nextFrame;
    return true;
  }
  const startFrame = model.normalizeTextFrame(
    detail?.startFrame || runtime.draftPageTextFrame
  );
  runtime.draftPageTextFrame = nextFrame;
  const before = clonePageEditSnapshot(runtime);
  before.textFrame = startFrame;
  const after = clonePageEditSnapshot(runtime);
  return recordPageEditChange(runtime, before, after);
}

function settleStructuredTextFrameForPageEditSave(runtime, pageId) {
  const editsStructuredTextFrame = (typeof pageIsMarkdown === 'function'
    && pageIsMarkdown(runtime.currentPage))
    || (typeof pageIsHnText === 'function' && pageIsHnText(runtime.currentPage));
  if (!editsStructuredTextFrame) return null;
  if (!runtimeIsLive(runtime) || runtime.currentPage?.id !== pageId) {
    throw new Error('The Page Edit frame owner is no longer current.');
  }
  const shell = globalThis.structuredTextPageShell;
  if (typeof shell?.settleActiveBoundaryDragForSave !== 'function') {
    throw new Error('The structured text frame interaction owner is unavailable.');
  }
  const settlement = shell.settleActiveBoundaryDragForSave(runtime.dom.canvasArea);
  if (!settlement?.boundaryFound || settlement.accepted !== true) {
    throw new Error('The structured text frame gesture could not be settled for Save.');
  }
  if (settlement.changed) {
    const model = globalThis.structuredTextFrameModel;
    const settledFrame = model.normalizeTextFrame(settlement.frame);
    const draftFrame = model.normalizeTextFrame(runtime.draftPageTextFrame);
    if (settledFrame.centerWorldX !== draftFrame.centerWorldX
      || settledFrame.preferredWidth !== draftFrame.preferredWidth) {
      throw new Error('The settled frame did not reach the Page Edit draft.');
    }
  }
  return settlement;
}

function enterPageEditMode(runtime, { selectObjectId = null } = {}) {
  const visualObjects = (runtime.currentPage?.objects || [])
    .filter((object) => isDisplayableObject(object) && isVisibleObject(object));
  const editsStructuredTextFrame = (typeof pageIsMarkdown === 'function'
    && pageIsMarkdown(runtime.currentPage))
    || (typeof pageIsHnText === 'function' && pageIsHnText(runtime.currentPage));
  const editsCanvasObjects = pageTypesModel.normalizePageType(runtime.currentPage?.type)
    === pageTypesModel.PAGE_TYPES.CANVAS;
  if ((!editsStructuredTextFrame && !editsCanvasObjects)
    || (editsCanvasObjects && visualObjects.length < 2) || runtime.pageEditMode
    || runtime.highlightEditDraft
    || markdownPageMutationLocks.has(runtime.currentPage?.id)) return;
  if (runtime.blockEditMode) cancelBlockEdits(runtime);
  closeAddLinkPopover(runtime);
  runtime.originalPageObjects = pageObjectsModel.cloneObjects(runtime.currentPage.objects);
  runtime.originalPageBlocks = pageObjectsModel.cloneBlocks(runtime.currentPage.blocks);
  runtime.originalPageTextFrame = editsStructuredTextFrame
    ? globalThis.structuredTextFrameModel.normalizeTextFrame(runtime.currentPage.textFrame)
    : null;
  runtime.draftPageObjects = pageObjectsModel.cloneObjects(runtime.currentPage.objects);
  runtime.draftPageBlocks = pageObjectsModel.cloneBlocks(runtime.currentPage.blocks);
  runtime.draftPageTextFrame = runtime.originalPageTextFrame
    ? { ...runtime.originalPageTextFrame }
    : null;
  runtime.selectedPageObjectId = pageTypeOwnsCanvasObjectEdits(runtime)
    ? selectObjectId
    : null;
  beginCanvasUndoContext(runtime, 'page-edit');
  clearCanvasPointerHover(runtime);
  setPageEditMode(runtime, true);
  renderCanvas(runtime, runtime.draftPageObjects, [], { fit: false });
  setSelectedPageObject(
    runtime,
    pageTypeOwnsCanvasObjectEdits(runtime) ? selectObjectId : null
  );
  showRuntimeStatus(runtime, '');
}

function cancelPageEdits(runtime) {
  if (!runtime.pageEditMode) return;
  if (runtime.pageObjectDrag
    && runtime.dom.canvasArea.hasPointerCapture(runtime.pageObjectDrag.pointerId)) {
    runtime.dom.canvasArea.releasePointerCapture(runtime.pageObjectDrag.pointerId);
  }
  runtime.pageObjectDrag = null;
  runtime.currentPage.objects = pageObjectsModel.cloneObjects(runtime.originalPageObjects);
  runtime.currentPage.blocks = pageObjectsModel.cloneBlocks(runtime.originalPageBlocks);
  if (runtime.originalPageTextFrame) {
    runtime.currentPage.textFrame = { ...runtime.originalPageTextFrame };
  }
  runtime.draftPageObjects = [];
  runtime.draftPageBlocks = [];
  runtime.originalPageTextFrame = null;
  runtime.draftPageTextFrame = null;
  runtime.selectedPageObjectId = null;
  clearCanvasUndoContext(runtime);
  setPageEditMode(runtime, false);
  renderCanvas(
    runtime,
    runtime.currentPage.objects,
    runtime.currentPage.blocks,
    { fit: false }
  );
  renderRelations(runtime, runtime.currentPage);
  showRuntimeStatus(runtime, '');
}

async function savePageEdits(runtime) {
  if (!runtimeIsLive(runtime) || !runtime.pageEditMode || runtime.pageEditSaveInProgress) return;
  const pageId = runtime.currentPage.id;
  const operation = captureRuntimeOperation(runtime, {
    scope: 'page-edit-save',
    pageId
  });
  runtime.pageEditSaveInProgress = true;
  runtime.dom.editBlockButton.disabled = true;
  showRuntimeStatus(runtime, 'Saving…');
  try {
    settleStructuredTextFrameForPageEditSave(runtime, pageId);
    const textFrameToSave = runtime.draftPageTextFrame
      ? { ...runtime.draftPageTextFrame }
      : null;
    const isHnText = typeof pageIsHnText === 'function'
      && pageIsHnText(runtime.currentPage);
    const savePayload = isHnText
      ? { ...(textFrameToSave ? { textFrame: textFrameToSave } : {}) }
      : {
        objects: runtime.draftPageObjects,
        blocks: runtime.draftPageBlocks,
        ...(textFrameToSave ? { textFrame: textFrameToSave } : {}),
        allowObjectSetChanges: true
      };
    const savedPage = await request(pageApiUrl(pageId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(savePayload)
    });
    pageIndex = await request('/api/page-index');
    const operationIsCurrent = runtimeOperationIsCurrent(operation);
    const canonical = commitCanonicalPage(savedPage, {
      originRuntime: operationIsCurrent ? runtime : null
    });
    renderPageList();
    if (!operationIsCurrent) return;
    runtime.currentPageEntry = pageIndex.pages.find((page) => page.id === canonical.id);
    runtime.currentPage = canonical;
    runtime.originalPageObjects = pageObjectsModel.cloneObjects(savedPage.objects);
    runtime.originalPageBlocks = pageObjectsModel.cloneBlocks(savedPage.blocks);
    const savedIsStructuredText = (typeof pageIsMarkdown === 'function' && pageIsMarkdown(savedPage))
      || (typeof pageIsHnText === 'function' && pageIsHnText(savedPage));
    runtime.originalPageTextFrame = savedIsStructuredText
      ? globalThis.structuredTextFrameModel.normalizeTextFrame(savedPage.textFrame)
      : null;
    runtime.draftPageObjects = [];
    runtime.draftPageBlocks = [];
    runtime.draftPageTextFrame = null;
    runtime.selectedPageObjectId = null;
    runtime.pageObjectDrag = null;
    clearCanvasUndoContext(runtime, { commit: true });
    setPageEditMode(runtime, false);
    renderCanvas(runtime, savedPage.objects, savedPage.blocks, { fit: false });
    renderRelations(runtime, savedPage);
    showRuntimeStatus(runtime, 'Saved', false, 1800);
  } catch (error) {
    if (runtimeOperationIsCurrent(operation)) {
      showRuntimeStatus(runtime, error.message, true);
    }
  } finally {
    if (runtimeOperationOwnerIsCurrent(operation)) {
      runtime.pageEditSaveInProgress = false;
      updateEditAvailability(runtime);
    }
  }
}

function updateCanvasBoundsWithoutFitting(runtime, { preserveMarkdownBottom = false } = {}) {
  const { canvasStage } = runtime.dom;
  const objectBounds = runtime.canvasObjects.length
    ? getObjectBounds(runtime.canvasObjects)
    : null;
  const rendersMarkdown = typeof pageIsMarkdown === 'function'
    && pageIsMarkdown(runtime.currentPage);
  if (rendersMarkdown && typeof updateMarkdownPageLayer === 'function') {
    const currentBounds = typeof getMarkdownDocumentBounds === 'function'
      ? getMarkdownDocumentBounds(canvasStage)
      : null;
    updateMarkdownPageLayer(canvasStage, {
      objectBounds,
      provisionalBottom: preserveMarkdownBottom ? currentBounds?.bottom : null
    });
    const markdownBounds = typeof getMarkdownDocumentBounds === 'function'
      ? getMarkdownDocumentBounds(canvasStage)
      : null;
    runtime.canvasBounds = combinedCanvasWorldBounds(runtime.canvasObjects, markdownBounds);
  } else {
    runtime.canvasBounds = objectBounds;
  }
  applyCanvasWorldBounds(runtime, runtime.canvasBounds);
}

function updateDraftObjectGeometry(
  runtime,
  objectId,
  geometry,
  startingObject,
  startingBlocks
) {
  const object = runtime.draftPageObjects.find((item) => item.id === objectId);
  if (!object) return;
  Object.assign(object, geometry);
  runtime.draftPageBlocks = pageObjectsModel.transformAttachedBlocks(
    startingBlocks, objectId, startingObject, geometry
  );
  runtime.canvasObjects = runtime.draftPageObjects.filter(
    (item) => isDisplayableObject(item) && isVisibleObject(item)
  );
  const layer = runtime.dom.canvasStage.querySelector(
    `.canvas-object-layer[data-object-id="${CSS.escape(objectId)}"]`
  );
  if (layer) configureCanvasObjectLayer(runtime, layer, object);
  updateCanvasBoundsWithoutFitting(runtime, {
    preserveMarkdownBottom: Boolean(runtime.pageObjectDrag)
  });
  scheduleCanvasImageResolutionCheck(runtime);
}

function handlePageObjectPointerDown(runtime, event) {
  if (markdownOwnsPointerEvent(runtime, event)) return;
  if (!runtime.pageEditMode || !pageTypeOwnsCanvasObjectEdits(runtime)
    || runtime.pageEditSaveInProgress || event.button !== 0) return;
  const handleElement = event.target.closest?.('.canvas-object-resize-handle');
  let object = null;
  let handle = null;
  if (handleElement) {
    const layer = handleElement.closest('.canvas-object-layer');
    object = runtime.draftPageObjects
      .find((item) => item.id === layer?.dataset.objectId) || null;
    handle = handleElement.dataset.resizeHandle;
  } else {
    object = pageObjectsModel.resolveEditableObjectTarget(
      runtime.canvasObjects,
      screenToWorld(runtime, event.clientX, event.clientY)
    ).object;
  }
  if (!object) {
    setSelectedPageObject(runtime, null);
    return;
  }
  event.preventDefault();
  setSelectedPageObject(runtime, object.id);
  runtime.dom.canvasArea.setPointerCapture(event.pointerId);
  runtime.pageObjectDrag = {
    operation: captureRuntimeOperation(runtime, {
      scope: 'page-object-drag',
      pageId: runtime.currentPage?.id || null,
      pointerId: event.pointerId
    }),
    pointerId: event.pointerId,
    objectId: object.id,
    handle,
    startPoint: screenToWorld(runtime, event.clientX, event.clientY),
    startObject: { ...object },
    startBlocks: pageObjectsModel.cloneBlocks(runtime.draftPageBlocks),
    beforeSnapshot: clonePageEditSnapshot(runtime)
  };
}

function constrainMarkdownObjectGeometryToDocumentTop(runtime, geometry, drag) {
  const numberOr = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  if (!(typeof pageIsMarkdown === 'function' && pageIsMarkdown(runtime.currentPage))
    || numberOr(geometry?.y, 0) >= 0) return geometry;
  const handle = String(drag?.handle || '');
  if (!handle.includes('n')) return { ...geometry, y: 0 };
  const start = drag.startObject;
  const minimum = Math.max(1, Number(pageObjectsModel.MIN_OBJECT_SIZE) || 48);
  const fixedBottom = numberOr(start.y, 0) + Math.max(minimum, numberOr(start.height, minimum));
  if (fixedBottom <= minimum) return { ...geometry, y: 0 };
  const aspect = Math.max(0.0001, numberOr(start.width, minimum)
    / Math.max(0.0001, numberOr(start.height, minimum)));
  const height = fixedBottom;
  const width = height * aspect;
  const fixedX = handle.includes('w')
    ? numberOr(start.x, 0) + numberOr(start.width, width)
    : numberOr(start.x, 0);
  return {
    ...geometry,
    x: handle.includes('w') ? fixedX - width : fixedX,
    y: 0,
    width,
    height
  };
}

function handlePageObjectPointerMove(runtime, event) {
  const drag = runtime.pageObjectDrag;
  if (!drag || !runtimeOperationIsCurrent(drag.operation)
    || event.pointerId !== drag.pointerId) return;
  event.preventDefault();
  const point = screenToWorld(runtime, event.clientX, event.clientY);
  let geometry;
  if (drag.handle) {
    geometry = pageObjectsModel.proportionalGeometry(
      drag.startObject, drag.handle, point
    );
  } else {
    geometry = {
      ...drag.startObject,
      x: drag.startObject.x + point.x - drag.startPoint.x,
      y: drag.startObject.y + point.y - drag.startPoint.y
    };
  }
  geometry = constrainMarkdownObjectGeometryToDocumentTop(runtime, geometry, drag);
  updateDraftObjectGeometry(
    runtime,
    drag.objectId,
    geometry,
    drag.startObject,
    drag.startBlocks
  );
}

function finishPageObjectDrag(runtime, event, shouldCommit = true) {
  const drag = runtime.pageObjectDrag;
  if (!drag || !runtimeOperationIsCurrent(drag.operation)
    || event.pointerId !== drag.pointerId) return;
  event.preventDefault();
  if (runtime.dom.canvasArea.hasPointerCapture(event.pointerId)) {
    runtime.dom.canvasArea.releasePointerCapture(event.pointerId);
  }
  const completed = drag;
  runtime.pageObjectDrag = null;
  if (!shouldCommit) {
    applyPageEditSnapshot(runtime, completed.beforeSnapshot, completed.objectId);
    return;
  }
  updateCanvasBoundsWithoutFitting(runtime);
  applyCanvasTransform(runtime);
  recordPageEditChange(runtime, completed.beforeSnapshot, clonePageEditSnapshot(runtime), {
    undoSelection: completed.objectId,
    redoSelection: completed.objectId
  });
}

function applyPageObjectLayerCommand(runtime, objectId, command) {
  if (!pageTypeOwnsCanvasObjectEdits(runtime)) return;
  const beforeSnapshot = clonePageEditSnapshot(runtime);
  const next = pageObjectsModel.reorderObjects(runtime.draftPageObjects, objectId, command);
  if (next.every((object, index) => object.id === runtime.draftPageObjects[index]?.id)) return;
  runtime.draftPageObjects = next;
  renderCanvas(runtime, runtime.draftPageObjects, [], { fit: false });
  setSelectedPageObject(runtime, objectId);
  recordPageEditChange(runtime, beforeSnapshot, clonePageEditSnapshot(runtime), {
    undoSelection: objectId,
    redoSelection: objectId
  });
}

async function handlePageObjectContextMenu(runtime, event) {
  if (!runtime.pageEditMode || !pageTypeOwnsCanvasObjectEdits(runtime)
    || !window.nativeContextMenu?.available()) return;
  const object = pageObjectsModel.resolveEditableObjectTarget(
    runtime.canvasObjects,
    screenToWorld(runtime, event.clientX, event.clientY)
  ).object;
  if (!object) return;
  setSelectedPageObject(runtime, object.id);
  const visibleOrder = runtime.canvasObjects.map((item) => item.id);
  const index = visibleOrder.indexOf(object.id);
  const operation = captureRuntimeOperation(runtime, {
    scope: 'page-object-menu',
    pageId: runtime.currentPage?.id || null,
    objectId: object.id
  });
  const command = await window.nativeContextMenu.open(event, {
    type: 'page-object',
    targetId: object.id,
    canBringForward: index >= 0 && index < visibleOrder.length - 1,
    canBringToFront: index >= 0 && index < visibleOrder.length - 1,
    canSendBackward: index > 0,
    canSendToBack: index > 0
  });
  if (!runtimeOperationIsCurrent(operation) || !runtime.pageEditMode
    || !pageTypeOwnsCanvasObjectEdits(runtime)
    || !runtime.draftPageObjects.some((item) => item.id === object.id)) return;
  applyPageObjectLayerCommand(runtime, object.id, command);
}

function disposeCanvasRuntime(runtime) {
  if (!runtime) return false;
  const area = runtime.dom?.canvasArea;
  const releasePointer = (gesture) => {
    const pointerId = gesture?.pointerId;
    if (pointerId === undefined || !area?.hasPointerCapture?.(pointerId)) return;
    try {
      area.releasePointerCapture(pointerId);
    } catch (_error) {
      // The native capture may already have ended during Pane teardown.
    }
  };

  releasePointer(runtime.blockDrawing);
  releasePointer(runtime.blockTransform);
  releasePointer(runtime.pageObjectDrag);
  runtime.blockPreview?.remove?.();
  runtime.blockPreview = null;
  runtime.blockDrawing = null;
  runtime.blockTransform = null;
  runtime.pageObjectDrag = null;
  runtime.gestureStartScale = 1;

  clearCanvasPointerHover(runtime);
  closeQuickColourBar(runtime);
  disconnectStructuredTextViewport(runtime);

  clearTimeout(runtime.canvasImageResolutionTimer);
  runtime.canvasImageResolutionTimer = null;
  runtime.canvasImageSessionPageId = null;
  runtime.canvasImageSessionGeneration += 1;
  runtime.canvasImageVariantStates.clear();
  runtime.canvasObjects = [];
  runtime.canvasBounds = null;
  runtime.blockStateRequests = new WeakMap();

  runtime.blockEditMode = false;
  runtime.blockSaveInProgress = false;
  runtime.originalBlocks = [];
  runtime.draftBlocks = [];
  runtime.selectedBlockId = null;
  runtime.canvasUndoContextId = null;
  runtime.blockVisualMode = BLOCK_MODE.NORMAL;
  runtime.activeHighlightGroupId = null;
  runtime.activeHighlightBlockIds = new Set();
  runtime.selectedHighlightBlockIds = new Set();
  runtime.pageEditMode = false;
  runtime.pageEditSaveInProgress = false;
  runtime.originalPageObjects = [];
  runtime.originalPageBlocks = [];
  runtime.originalPageTextFrame = null;
  runtime.draftPageObjects = [];
  runtime.draftPageBlocks = [];
  runtime.draftPageTextFrame = null;
  runtime.selectedPageObjectId = null;
  runtime.hoveredCanvasBlockId = null;
  runtime.externalLinkHoveredBlockId = null;
  runtime.addLinkTarget = null;
  runtime.highlightEditDraft = null;
  runtime.highlightSaveInProgress = false;
  clearTimeout(runtime.statusTimer);
  runtime.statusTimer = null;

  area?.classList?.remove('block-edit-mode', 'page-edit-mode');
  runtime.dom?.canvasStage?.classList?.remove('has-highlight-mask');
  return true;
}

globalThis.addEventListener?.('resize', () => {
  const runtime = activePaneRuntime();
  if (runtime) positionQuickColourBar(runtime);
});

globalThis.colourfulBlockCanvasRuntime = Object.freeze({
  refreshAppearance: refreshCanvasBlockAppearance,
  closeQuickColourBar: (runtime = activePaneRuntime()) => {
    if (runtime) closeQuickColourBar(runtime);
  },
  quickTargetId: (runtime = activePaneRuntime()) => (
    runtime ? quickColourState(runtime).blockId : null
  )
});
