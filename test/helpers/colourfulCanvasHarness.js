'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

const appearanceSettingsModel = require('../../public/appearanceSettings');
const imageResolutionModel = require('../../public/imageResolution');
const vaultAppearanceStoreModel = require('../../public/vaultAppearanceStore');
const categoryNavigation = require('../../public/categoryNavigation');
const pageObjectsModel = require('../../public/pageObjects');
const pageTypesModel = require('../../public/pageTypes');
const resourceLocationsModel = require('../../public/resourceLocations');
const zoomControls = require('../../public/zoomControls');
const { FakeElement, descendants } = require('./markdownFakeDom');

function dataProperty(name) {
  return String(name).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function splitSelectorList(selector) {
  const parts = [];
  let start = 0;
  let quote = '';
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (quote) {
      if (character === quote && selector[index - 1] !== '\\') quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[') bracketDepth += 1;
    else if (character === ']') bracketDepth -= 1;
    else if (character === '(') parenthesisDepth += 1;
    else if (character === ')') parenthesisDepth -= 1;
    else if (character === ',' && bracketDepth === 0 && parenthesisDepth === 0) {
      parts.push(selector.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(selector.slice(start).trim());
  return parts.filter(Boolean);
}

function splitDescendantSelector(selector) {
  const parts = [];
  let start = 0;
  let quote = '';
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (quote) {
      if (character === quote && selector[index - 1] !== '\\') quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[') bracketDepth += 1;
    else if (character === ']') bracketDepth -= 1;
    else if (character === '(') parenthesisDepth += 1;
    else if (character === ')') parenthesisDepth -= 1;
    else if (/\s/.test(character) && bracketDepth === 0 && parenthesisDepth === 0) {
      const part = selector.slice(start, index).trim();
      if (part) parts.push(part);
      while (/\s/.test(selector[index + 1] || '')) index += 1;
      start = index + 1;
    }
  }
  const finalPart = selector.slice(start).trim();
  if (finalPart) parts.push(finalPart);
  return parts;
}

function attributeValue(element, name) {
  if (name.startsWith('data-')) return element.dataset?.[dataProperty(name.slice(5))];
  if (name === 'class') return element.className;
  if (name === 'id') return element.id || element.attributes?.id;
  if (Object.hasOwn(element.attributes || {}, name)) return element.attributes[name];
  if (Object.hasOwn(element, name)) return element[name];
  return undefined;
}

function matchesCompound(element, selector) {
  let remaining = selector.trim();
  if (!remaining) return false;
  remaining = remaining.replace(/^:scope/, '');

  for (const match of [...remaining.matchAll(/:not\(([^()]*)\)/g)]) {
    if (matchesCompound(element, match[1])) return false;
  }
  remaining = remaining.replace(/:not\([^()]*\)/g, '');

  const tag = remaining.match(/^[a-z][a-z0-9-]*/i)?.[0];
  if (tag && element.tagName !== tag.toUpperCase()) return false;

  for (const [, id] of remaining.matchAll(/#([a-z0-9_-]+)/gi)) {
    if ((element.id || element.attributes?.id) !== id) return false;
  }
  for (const [, className] of remaining.matchAll(/\.([a-z0-9_-]+)/gi)) {
    if (!element.classList?.contains(className)) return false;
  }
  for (const match of remaining.matchAll(
    /\[([a-z0-9_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\]/gi
  )) {
    const name = match[1];
    const expected = match[2] ?? match[3] ?? match[4];
    const actual = attributeValue(element, name);
    if (actual === undefined || (expected !== undefined && String(actual) !== expected)) return false;
  }
  return true;
}

function matchesSelector(element, selector) {
  const parts = splitDescendantSelector(selector);
  if (!parts.length || !matchesCompound(element, parts.at(-1))) return false;
  let ancestor = element.parentElement;
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    while (ancestor && !matchesCompound(ancestor, parts[index])) ancestor = ancestor.parentElement;
    if (!ancestor) return false;
    ancestor = ancestor.parentElement;
  }
  return true;
}

class CanvasFakeElement extends FakeElement {
  constructor(document, options = {}) {
    super(options);
    this.ownerDocument = document;
    this.hidden = false;
    this.id = '';
    this.type = '';
    this.role = '';
    this.scrollLeft = 0;
    this.scrollWidth = 0;
    this.clientWidth = 0;
    this.clientHeight = 0;
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    this._rect = null;
  }

  append(...nodes) {
    const expanded = [];
    for (const node of nodes.flat()) {
      if (node?.nodeType === 11) {
        expanded.push(...node.childNodes);
        node.childNodes = [];
      } else {
        expanded.push(node);
      }
    }
    for (const node of expanded) node?.remove?.();
    super.append(...expanded);
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    super.setAttribute(name, stringValue);
    if (name === 'id') this.id = stringValue;
    else if (name === 'class') this.className = stringValue;
    else if (name === 'role') this.role = stringValue;
    else if (name.startsWith('data-')) this.dataset[dataProperty(name.slice(5))] = stringValue;
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    if (name === 'role') return this.role || this.attributes[name] || null;
    if (name.startsWith('data-')) {
      const value = this.dataset[dataProperty(name.slice(5))];
      return value === undefined ? null : String(value);
    }
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  hasAttribute(name) {
    return this.getAttribute(name) !== null;
  }

  removeAttribute(name) {
    super.removeAttribute(name);
    if (name === 'id') this.id = '';
    else if (name === 'role') this.role = '';
    else if (name.startsWith('data-')) delete this.dataset[dataProperty(name.slice(5))];
  }

  matches(selector) {
    return splitSelectorList(String(selector)).some((candidate) => matchesSelector(this, candidate));
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches?.(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    return descendants(this).filter((element) => (
      element !== this && element?.nodeType === 1 && element.matches?.(selector)
    ));
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  async dispatch(type, initial = {}) {
    const event = {
      ...initial,
      type,
      target: initial.target || this,
      currentTarget: null,
      defaultPrevented: false,
      cancelBubble: false,
      immediatePropagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {
        this.cancelBubble = true;
        initial.stopPropagation?.();
      },
      stopImmediatePropagation() {
        this.immediatePropagationStopped = true;
        this.cancelBubble = true;
        initial.stopImmediatePropagation?.();
      }
    };
    const pending = [];
    for (let current = this; current; current = current.parentElement) {
      event.currentTarget = current;
      event.immediatePropagationStopped = false;
      for (const listener of [...(current.listeners.get(type) || [])]) {
        const result = typeof listener === 'function'
          ? listener.call(current, event)
          : listener?.handleEvent?.(event);
        if (result && typeof result.then === 'function') pending.push(result);
        if (event.immediatePropagationStopped) break;
      }
      if (event.cancelBubble) break;
    }
    await Promise.all(pending);
    return event;
  }

  dispatchEvent(event) {
    return this.dispatch(event.type, event);
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  setSelectionRange(start, end, direction = 'none') {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction;
  }

  get isConnected() {
    let current = this;
    while (current?.parentNode) current = current.parentNode;
    return current === this.ownerDocument?.documentElement;
  }

  getBoundingClientRect() {
    if (this._rect) return { ...this._rect };
    let left = Number.parseFloat(this.style.left) || 0;
    let top = Number.parseFloat(this.style.top) || 0;
    const width = this.offsetWidth || Number.parseFloat(this.style.width) || 0;
    const height = this.offsetHeight || Number.parseFloat(this.style.height) || 0;
    const canvasArea = this.closest?.('.canvas-area');
    const canvasStage = this.closest?.('.canvas-stage');
    if (canvasArea && this !== canvasArea) {
      for (let current = this.parentElement;
        current && current !== canvasArea && current !== canvasStage;
        current = current.parentElement) {
        left += Number.parseFloat(current.style.left) || 0;
        top += Number.parseFloat(current.style.top) || 0;
      }
      const areaRect = canvasArea._rect || {
        left: 0,
        top: 0
      };
      if (canvasStage) {
        const transform = String(canvasStage.style.transform || '');
        const translated = transform.match(
          /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/
        );
        const scaled = transform.match(/scale\(\s*(-?[\d.]+)\s*\)/);
        const scale = Number(scaled?.[1]) || 1;
        left = areaRect.left + (Number(translated?.[1]) || 0) + left * scale;
        top = areaRect.top + (Number(translated?.[2]) || 0) + top * scale;
        return {
          x: left,
          y: top,
          left,
          top,
          width: width * scale,
          height: height * scale,
          right: left + width * scale,
          bottom: top + height * scale
        };
      }
      left += areaRect.left;
      top += areaRect.top;
    }
    return {
      x: left,
      y: top,
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height
    };
  }

  getClientRects() {
    return this.hidden ? [] : [this.getBoundingClientRect()];
  }

  setPointerCapture(pointerId) {
    this._capturedPointerId = pointerId;
  }

  hasPointerCapture(pointerId) {
    return this._capturedPointerId === pointerId;
  }

  releasePointerCapture(pointerId) {
    if (this._capturedPointerId === pointerId) this._capturedPointerId = null;
  }
}

class CanvasFakeDocument {
  constructor() {
    this.listeners = new Map();
    this.activeElement = null;
    this.documentElement = new CanvasFakeElement(this, { tagName: 'html' });
    this.body = new CanvasFakeElement(this, { tagName: 'body' });
    this.documentElement.append(this.body);
  }

  createElement(tagName) {
    return new CanvasFakeElement(this, { tagName });
  }

  createElementNS(namespaceURI, tagName) {
    return new CanvasFakeElement(this, { tagName, namespaceURI });
  }

  createDocumentFragment() {
    return new CanvasFakeElement(this, { tagName: '#document-fragment', nodeType: 11 });
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  async dispatch(type, initial = {}) {
    const event = {
      ...initial,
      type,
      target: initial.target || this,
      currentTarget: this,
      defaultPrevented: false,
      immediatePropagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { initial.stopPropagation?.(); },
      stopImmediatePropagation() {
        this.immediatePropagationStopped = true;
        initial.stopImmediatePropagation?.();
      }
    };
    for (const listener of [...(this.listeners.get(type) || [])]) {
      const result = typeof listener === 'function'
        ? listener.call(this, event)
        : listener?.handleEvent?.(event);
      if (result && typeof result.then === 'function') await result;
      if (event.immediatePropagationStopped) break;
    }
    return event;
  }
}

function createUndoHarness() {
  const undoStack = [];
  const redoStack = [];
  let activeContext = null;
  return {
    undoStack,
    redoStack,
    record(entry) {
      undoStack.push(entry);
      redoStack.length = 0;
      return true;
    },
    undo() {
      const entry = undoStack.pop();
      if (!entry) return false;
      entry.undo();
      redoStack.push(entry);
      return true;
    },
    redo() {
      const entry = redoStack.pop();
      if (!entry) return false;
      entry.redo();
      undoStack.push(entry);
      return true;
    },
    beginContext(context) {
      activeContext = context;
      return context;
    },
    cancelContext() {
      activeContext = null;
    },
    commitContext() {
      activeContext = null;
    },
    activeContext: () => activeContext
  };
}

function pointerEvent({ pointerId = 7, clientX, clientY, target, button = 0 } = {}) {
  return {
    pointerId,
    clientX,
    clientY,
    target,
    button,
    prevented: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() {},
    stopImmediatePropagation() {}
  };
}

async function createColourfulCanvasHarness({ appearance = null, globals = {} } = {}) {
  const document = new CanvasFakeDocument();
  const pane = document.createElement('section');
  pane.className = 'workspace-pane is-workspace-pane-active';
  pane.dataset.workspacePaneId = 'pane_test';
  const canvasArea = document.createElement('div');
  canvasArea.className = 'canvas-area block-edit-mode';
  canvasArea.clientWidth = 800;
  canvasArea.clientHeight = 600;
  canvasArea._rect = {
    x: 100, y: 50, left: 100, top: 50,
    width: 800, height: 600, right: 900, bottom: 650
  };
  const canvasStage = document.createElement('div');
  canvasStage.className = 'canvas-stage';
  canvasArea.append(canvasStage);
  pane.append(canvasArea);
  document.body.append(pane);

  const object = {
    id: 'object_colour_canvas',
    type: 'image',
    src: 'assets/images/colour-canvas.png',
    displayable: true,
    visible: true,
    x: 0,
    y: 0,
    width: 400,
    height: 300
  };
  const objectLayer = document.createElement('div');
  objectLayer.className = 'canvas-object-layer';
  objectLayer.dataset.objectId = object.id;
  objectLayer.style.left = `${object.x}px`;
  objectLayer.style.top = `${object.y}px`;
  objectLayer.style.width = `${object.width}px`;
  objectLayer.style.height = `${object.height}px`;
  canvasStage.append(objectLayer);

  const undoManager = createUndoHarness();
  const editBlockButton = document.createElement('button');
  const normalizedAppearance = appearanceSettingsModel.normalizeAppearanceSettings(appearance);
  const currentPage = {
    id: 'page_colour_canvas',
    code: 'colour_canvas',
    type: 'canvas',
    objects: [object],
    blocks: []
  };
  const activeTab = {
    id: 'tab_colour_canvas',
    currentPageId: currentPage.id,
    viewState: {
      panX: 0,
      panY: 0,
      zoom: 1,
      viewportInitialized: true,
      infoPanels: [],
      infoPanelZCounter: 0,
      checkedHighlightGroupIds: []
    }
  };
  const session = {
    activeTab: () => activeTab,
    tabById: (tabId) => tabId === activeTab.id ? activeTab : null,
    tabs: () => [activeTab],
    saveViewState: (tabId, viewState) => {
      if (tabId !== activeTab.id) return false;
      activeTab.viewState = JSON.parse(JSON.stringify(viewState));
      return true;
    }
  };
  const runtime = {
    paneId: 'pane_test',
    runtimeId: 'runtime_colour_canvas',
    lifecycleEpoch: 1,
    disposed: false,
    session,
    mounted: {
      tabId: activeTab.id,
      pageId: currentPage.id,
      kind: currentPage.type,
      generation: 1
    },
    dom: { canvasArea, canvasStage, editBlockButton },
    currentPage,
    canvasObjects: [object],
    canvasBounds: null,
    canvasView: { scale: 1, offsetX: 0, offsetY: 0 },
    canvasImageSessionPageId: null,
    canvasImageSessionGeneration: 0,
    canvasImageVariantStates: new Map(),
    canvasImageResolutionTimer: null,
    blockEditMode: true,
    pageEditMode: false,
    pageEditSaveInProgress: false,
    blockSaveInProgress: false,
    blockVisualMode: 'block-edit',
    originalBlocks: [],
    draftBlocks: [],
    blockDrawing: null,
    blockPreview: null,
    selectedBlockId: null,
    blockTransform: null,
    originalPageObjects: [],
    originalPageBlocks: [],
    originalPageTextFrame: null,
    draftPageObjects: [],
    draftPageBlocks: [],
    draftPageTextFrame: null,
    selectedPageObjectId: null,
    pageObjectDrag: null,
    hoveredCanvasBlockId: null,
    activeHighlightGroupId: null,
    activeHighlightBlockIds: new Set(),
    selectedHighlightBlockIds: new Set(),
    highlightEditDraft: null,
    blockStateRequests: new WeakMap(),
    addLinkTarget: null,
    linkPickMode: null,
    addLinkInProgress: false,
    quickColour: {
      blockId: null,
      pageId: null,
      overlayHost: null,
      resizeObserver: null,
      manualPosition: null,
      drag: null,
      suppressClickTimer: null,
      suppressNextClick: false,
      generation: 0
    },
    infoPanelsSuspended: false,
    suspendedInfoPanelEditor: null,
    temporaryInfoBlockId: null,
    infoPanelEditor: null,
    infoPanelEditorRevision: 0,
    infoPanelGeometryGesture: null,
    infoPanelFocusFrame: null
  };
  const workspacePane = {
    id: runtime.paneId,
    element: pane,
    session,
    viewContext: runtime
  };
  const runtimeIsLive = (candidate) => candidate === runtime && !runtime.disposed
    && workspacePane.viewContext === runtime;
  const captureRuntimeOperation = (candidate, detail = {}) => ({
    runtime: candidate,
    runtimeId: candidate?.runtimeId,
    lifecycleEpoch: candidate?.lifecycleEpoch,
    session: candidate?.session,
    tab: candidate?.session?.activeTab?.() || null,
    tabId: candidate?.session?.activeTab?.()?.id || null,
    pageId: detail.pageId ?? candidate?.currentPage?.id ?? null,
    mountGeneration: candidate?.mounted?.generation ?? null,
    ...detail
  });
  const runtimeOperationIsCurrent = (operation) => runtimeIsLive(operation?.runtime)
    && operation.runtimeId === runtime.runtimeId
    && operation.lifecycleEpoch === runtime.lifecycleEpoch
    && operation.session === runtime.session
    && operation.tab === runtime.session.activeTab()
    && operation.tabId === runtime.session.activeTab()?.id
    && operation.pageId === runtime.currentPage?.id
    && operation.mountGeneration === runtime.mounted?.generation;
  const environment = {
    console,
    setTimeout,
    clearTimeout,
    document,
    window: {},
    CSS: { escape: (value) => String(value) },
    MIN_CANVAS_SCALE: 0.1,
    MAX_CANVAS_SCALE: 6,
    CANVAS_FIT_PADDING: 32,
    MIN_BLOCK_SIZE: 8,
    BLOCK_MOVE_THRESHOLD: 3,
    BLOCK_STATE: Object.freeze({ HIDDEN: 0, DEFAULT: 1, HIGHLIGHTED: 2, ACTIVE: 3 }),
    BLOCK_MODE: Object.freeze({
      NORMAL: 'normal',
      BLOCK_EDIT: 'block-edit',
      HIGHLIGHT_VIEW: 'highlight-view',
      HIGHLIGHT_EDIT: 'highlight-edit'
    }),
    pageObjectsModel,
    resourceLocationsModel,
    appearanceSettingsModel,
    imageResolutionModel,
    pageTypesModel,
    zoomControls,
    zoomSensitivity: 1,
    appearanceSettings: normalizedAppearance,
    runtime,
    currentPage,
    canvasObjects: [object],
    canvasBounds: null,
    canvasView: { scale: 1, offsetX: 0, offsetY: 0 },
    canvasImageVariantStates: new Map(),
    canvasArea,
    canvasStage,
    emptyCanvas: document.createElement('p'),
    editBlockButton,
    blockEditMode: true,
    pageEditMode: false,
    pageEditSaveInProgress: false,
    blockSaveInProgress: false,
    blockVisualMode: 'block-edit',
    originalBlocks: [],
    draftBlocks: [],
    blockDrawing: null,
    blockPreview: null,
    selectedBlockId: null,
    blockTransform: null,
    selectedPageObjectId: null,
    pageObjectDrag: null,
    hoveredCanvasBlockId: null,
    activeHighlightBlockIds: new Set(),
    selectedHighlightBlockIds: new Set(),
    blockStateRequests: new WeakMap(),
    addLinkTarget: null,
    undoManager,
    runtimeIsLive,
    livingPaneRuntimes: () => [runtime],
    activePaneRuntime: () => runtime,
    captureRuntimeOperation,
    runtimeOperationIsCurrent,
    getWorkspacePane: (paneId) => paneId === workspacePane.id ? workspacePane : null,
    setActiveWorkspacePane: (paneId) => paneId === workspacePane.id ? workspacePane : null,
    pageForWorkspacePane: (ownerPane) => ownerPane?.viewContext?.currentPage || null,
    clickableBlockTargets: () => [],
    pageLinks: () => [],
    renderRelations: () => {},
    showStatus: () => {},
    showRuntimeStatus: () => {},
    setEditMenuOpen: () => {},
    setHighlightMenuOpen: () => {},
    updateEditAvailability: () => {},
    pageIsMarkdown: () => false,
    pageIsHnText: () => false,
    refreshHnTextControlStrip: () => {},
    getActivePane: () => workspacePane,
    ...globals
  };

  const context = vm.createContext(environment);
  const source = await fs.readFile(
    path.join(__dirname, '..', '..', 'public', 'js', 'canvasBlocks.js'),
    'utf8'
  );
  new vm.Script(source, { filename: 'public/js/canvasBlocks.js' }).runInContext(context);
  new vm.Script(`
    beginCanvasUndoContext(runtime, 'block-edit');
    ;globalThis.__colourfulCanvasTest = Object.freeze({
      pointerDown: (event) => handleBlockPointerDown(runtime, event),
      pointerMove: (event) => handleBlockPointerMove(runtime, event),
      finishDraw: (event, commit = true) => finishBlockDrawing(runtime, event, commit),
      finishTransform: (event, commit = true) => finishBlockTransform(runtime, event, commit),
      render: (blocks) => renderBlockOverlays(runtime, blocks),
      applyTransform: () => applyCanvasTransform(runtime),
      applySnapshot: (blocks, selection = null) => applyDraftBlockSnapshot(runtime, blocks, selection),
      select: (id) => setSelectedBlock(runtime, id),
      openQuickBar: (id) => {
        const block = runtime.draftBlocks.find((item) => item.id === id);
        if (!block || !runtime.currentPage?.id || !normalizedCanvasBlockAppearance().colourful) {
          return false;
        }
        const quickColour = quickColourState(runtime);
        quickColour.blockId = block.id;
        quickColour.pageId = runtime.currentPage.id;
        return Boolean(buildQuickColourBar(runtime, block));
      },
      closeQuickBar: () => closeQuickColourBar(runtime),
      reconcileQuickBar: (options) => reconcileQuickColourBar(runtime, options),
      positionQuickBar: () => positionQuickColourBar(runtime),
      recolour: (colour) => recolourQuickColourBlock(runtime, colour),
      concreteColour: (block, value = null) => canvasBlockConcreteColour(block, value),
      styleVariables: (block, value = null) => colourfulBlockStyleVariables(block, value),
      applyColourfulStyle: (element, block, value = null) => (
        applyColourfulBlockStyle(element, block, value)
      ),
      cancel: () => cancelBlockEdits(runtime),
      blocksJson: () => JSON.stringify(runtime.draftBlocks),
      drawingJson: () => JSON.stringify(runtime.blockDrawing && {
        pointerId: runtime.blockDrawing.pointerId,
        start: runtime.blockDrawing.start,
        objectId: runtime.blockDrawing.objectId,
        ...(runtime.blockDrawing.colour ? { colour: runtime.blockDrawing.colour } : {})
      }),
      selected: () => runtime.selectedBlockId,
      preview: () => runtime.blockPreview,
      overlay: (id) => blockOverlay(runtime, id),
      configureSemanticState: ({
        mode = BLOCK_MODE.NORMAL,
        blocks = [],
        selectedId = null,
        activeIds = [],
        highlightIds = []
      } = {}) => {
        runtime.currentPage.blocks = blocks;
        runtime.draftBlocks = blocks;
        runtime.blockVisualMode = mode;
        runtime.blockEditMode = mode === BLOCK_MODE.BLOCK_EDIT;
        runtime.selectedBlockId = selectedId;
        runtime.activeHighlightBlockIds = new Set(activeIds);
        runtime.selectedHighlightBlockIds = new Set(highlightIds);
        renderBlockOverlays(runtime, blocks);
      },
      deriveSemanticStateJson: (block, {
        mode = BLOCK_MODE.NORMAL,
        selectedId = null,
        activeIds = [],
        highlightIds = [],
        presentationStates = []
      } = {}) => JSON.stringify(deriveBlockPresentationInteraction(block, {
        mode,
        selectedBlockId: selectedId,
        activeHighlightBlockIds: new Set(activeIds),
        selectedHighlightBlockIds: new Set(highlightIds),
        presentationStates
      })),
      semanticStateJson: (id) => {
        const block = (runtime.blockEditMode ? runtime.draftBlocks : runtime.currentPage.blocks)
          .find((item) => item.id === id);
        const overlay = blockOverlay(runtime, id);
        const requests = blockPresentationRequests(runtime, overlay, block, { create: false });
        return JSON.stringify(currentBlockPresentationInteraction(
          runtime, block,
          requests?.values() || []
        ));
      },
      semanticInteractive: (id) => {
        const block = (runtime.blockEditMode ? runtime.draftBlocks : runtime.currentPage.blocks)
          .find((item) => item.id === id);
        return blockIsInteractive(runtime, block);
      },
      semanticRequest: (id, source, state) => {
        const overlay = blockOverlay(runtime, id);
        return overlay ? setBlockState(runtime, overlay, source, state) : null;
      },
      setSemanticAddLinkTarget: (id) => {
        runtime.addLinkTarget = id ? { blockId: id } : null;
        renderBlockOverlays(runtime, runtime.blockEditMode
          ? runtime.draftBlocks : runtime.currentPage.blocks);
      },
      semanticResolveId: (worldX, worldY) => resolveCanvasPointer(
        runtime,
        canvasArea.getBoundingClientRect().left + runtime.canvasView.offsetX
          + worldX * runtime.canvasView.scale,
        canvasArea.getBoundingClientRect().top + runtime.canvasView.offsetY
          + worldY * runtime.canvasView.scale
      ).block?.id || null,
      quickTarget: () => quickColourState(runtime).blockId,
      quickOverlay: () => canvasArea.querySelector('.canvas-block-quick-colour-overlay'),
      quickBar: () => canvasArea.querySelector('.canvas-block-quick-colour-bar'),
      quickBarCount: () => canvasArea.querySelectorAll('.canvas-block-quick-colour-bar').length,
      quickManualPositionJson: () => JSON.stringify(quickColourState(runtime).manualPosition),
      transformJson: () => JSON.stringify(runtime.blockTransform),
      runtime: () => globalThis.colourfulBlockCanvasRuntime || null,
      paneRuntime: () => runtime,
      setAppearance: (value) => { appearanceSettings = value; },
      setView: (patch) => Object.assign(runtime.canvasView, patch),
      viewJson: () => JSON.stringify(runtime.canvasView)
    });
  `, { filename: 'test/colourfulCanvasRuntime.inject.js' }).runInContext(context);

  async function installVaultSettingsRuntime({
    request = async (_url, options = {}) => JSON.parse(options.body || '{}')
  } = {}) {
    context.folderWarningTooltip = {
      createTooltip: () => ({ hide() {} }),
      createFolderNameCell: () => document.createElement('span')
    };
    context.categoryNavigation = categoryNavigation;
    context.categoryConfig = { groups: [], navigation: {} };
    context.request = request;
    let persistedAppearance = appearanceSettingsModel.normalizeAppearanceSettings(
      context.appearanceSettings
    );
    context.vaultAppearanceStore = vaultAppearanceStoreModel.createVaultAppearanceStore({
      model: appearanceSettingsModel,
      initialAppearance: context.appearanceSettings,
      persist: async (appearance) => {
        const saved = await request('/api/appearance', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(appearance)
        });
        persistedAppearance = appearanceSettingsModel.normalizeAppearanceSettings(saved);
        return saved;
      },
      refetch: async () => persistedAppearance
    });
    const vaultSettingsSource = await fs.readFile(
      path.join(__dirname, '..', '..', 'public', 'js', 'vaultSettings.js'),
      'utf8'
    );
    new vm.Script(vaultSettingsSource, {
      filename: 'public/js/vaultSettings.js'
    }).runInContext(context);
    new vm.Script(`
      ;globalThis.__colourfulPaletteTest = Object.freeze({
        controller: globalThis.blockColourPaletteController,
        flush: () => flushVaultSettingsWrites(),
        pickerOpen: () => Boolean(appearanceColourState),
        pickerError: () => appearanceColourState?.refs?.error?.textContent || '',
        saveOpenPicker: async (colour) => {
          if (!appearanceColourState) throw new Error('The colour picker is not open.');
          appearanceColourState.hex = appearanceSettingsModel.normalizeHexColour(colour);
          appearanceColourState.valid = true;
          appearanceColourState.colourValid = true;
          return saveAppearanceColour();
        }
      });
    `, { filename: 'test/colourfulPaletteRuntime.inject.js' }).runInContext(context);
    return context.__colourfulPaletteTest;
  }

  return {
    api: context.__colourfulCanvasTest,
    context,
    document,
    pane,
    canvasArea,
    canvasStage,
    object,
    objectLayer,
    undoManager,
    installVaultSettingsRuntime,
    pointer: (options) => pointerEvent({ target: canvasArea, ...options })
  };
}

module.exports = {
  CanvasFakeDocument,
  CanvasFakeElement,
  createColourfulCanvasHarness,
  createUndoHarness,
  matchesSelector,
  pointerEvent
};
