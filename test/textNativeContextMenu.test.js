const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const {
  buildNativeTextContextMenuTemplate,
  createNativeLookUpCommand,
  deriveTextContextMenuCapabilities,
  validContextMenuFrame
} = require('../desktop/nativeContextMenu');

const PROJECT_ROOT = path.join(__dirname, '..');

async function loadRendererContextMenu({
  selection = null,
  point = null,
  markdownPageView = null,
  hnTextPageView = null,
  createRange = null,
  setTimeoutFn = null,
  clearTimeoutFn = null
} = {}) {
  const source = await fs.readFile(
    path.join(PROJECT_ROOT, 'public/nativeContextMenu.js'),
    'utf8'
  );
  let contextMenuListener = null;
  const windowListeners = new Map();
  const document = {
    activeElement: null,
    addEventListener(type, listener, capture) {
      if (type === 'contextmenu' && capture === true) contextMenuListener = listener;
    },
    caretPositionFromPoint() {
      return point;
    },
    elementFromPoint() {
      return null;
    },
    ...(createRange ? { createRange } : {})
  };
  const window = {
    document,
    getSelection: () => selection,
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    cneDesktop: { showContextMenu: async () => null },
    ...(setTimeoutFn ? { setTimeout: setTimeoutFn } : {}),
    ...(clearTimeoutFn ? { clearTimeout: clearTimeoutFn } : {}),
    ...(markdownPageView ? { markdownPageView } : {}),
    ...(hnTextPageView ? { hnTextPageView } : {})
  };
  vm.runInNewContext(source, { window, console, Set, Date }, {
    filename: 'public/nativeContextMenu.js'
  });
  return {
    api: window.nativeContextMenu,
    contextMenuListener,
    document,
    window,
    windowListeners
  };
}

function fakeElement(closest = {}) {
  const element = {
    nodeType: 1,
    parentElement: null,
    closest(selector) {
      return Object.hasOwn(closest, selector) ? closest[selector] : null;
    }
  };
  return element;
}

function contextParams({
  isEditable = false,
  selectionText = '',
  canCut = false,
  canCopy = false,
  canPaste = false
} = {}) {
  return {
    isEditable,
    selectionText,
    editFlags: { canCut, canCopy, canPaste }
  };
}

function roles(template) {
  return template.map((item) => item.type === 'separator'
    ? '---'
    : item.role || item.label);
}

test('text capabilities classify editable, read-only, selected, and empty contexts', () => {
  assert.deepEqual(deriveTextContextMenuCapabilities(contextParams({
    isEditable: true,
    selectionText: 'private selection',
    canCut: true,
    canCopy: true,
    canPaste: true
  })), {
    owner: 'ordinary',
    editable: true,
    hasSelection: true,
    canCut: true,
    canCopy: true,
    canPaste: true
  });

  assert.deepEqual(deriveTextContextMenuCapabilities(contextParams({
    isEditable: true,
    canCut: true,
    canCopy: true,
    canPaste: true
  })), {
    owner: 'ordinary',
    editable: true,
    hasSelection: false,
    canCut: false,
    canCopy: false,
    canPaste: true
  });

  assert.deepEqual(deriveTextContextMenuCapabilities(contextParams({
    selectionText: 'read only selection',
    canCut: true,
    canCopy: true,
    canPaste: true
  })), {
    owner: 'read-only',
    editable: false,
    hasSelection: true,
    canCut: false,
    canCopy: true,
    canPaste: false
  });

  assert.equal(deriveTextContextMenuCapabilities(contextParams()), null);
  assert.equal(deriveTextContextMenuCapabilities(null), null);
  assert.equal(deriveTextContextMenuCapabilities('text'), null);
});

test('edit flags and semantic policy can restrict but never elevate mutation capabilities', () => {
  const missingFlags = deriveTextContextMenuCapabilities({
    isEditable: true,
    selectionText: 'selection'
  }, {
    textOwned: true,
    owner: 'markdown',
    editable: true,
    canCut: true,
    canCopy: true,
    canPaste: true
  });
  assert.deepEqual(missingFlags, {
    owner: 'markdown',
    editable: true,
    hasSelection: true,
    canCut: false,
    canCopy: false,
    canPaste: false
  });

  const restricted = deriveTextContextMenuCapabilities(contextParams({
    isEditable: true,
    selectionText: 'selection',
    canCut: true,
    canCopy: true,
    canPaste: true
  }), {
    textOwned: true,
    owner: 'markdown',
    editable: true,
    canCut: false,
    canCopy: true,
    canPaste: false
  });
  assert.deepEqual(restricted, {
    owner: 'markdown',
    editable: true,
    hasSelection: true,
    canCut: false,
    canCopy: true,
    canPaste: false
  });

  const forcedReadOnly = deriveTextContextMenuCapabilities(contextParams({
    isEditable: true,
    selectionText: 'selection',
    canCut: true,
    canCopy: true,
    canPaste: true
  }), {
    textOwned: true,
    owner: 'read-only',
    editable: false
  });
  assert.deepEqual(forcedReadOnly, {
    owner: 'read-only',
    editable: false,
    hasSelection: true,
    canCut: false,
    canCopy: true,
    canPaste: false
  });

  const rendererReadOnly = contextParams({
    selectionText: 'selection',
    canCut: true,
    canCopy: true,
    canPaste: true
  });
  assert.equal(
    deriveTextContextMenuCapabilities(rendererReadOnly, {
      textOwned: true,
      owner: 'cne',
      editable: true
    }).editable,
    false,
    'renderer read-only state cannot be elevated by a semantic descriptor'
  );
});

test('semantic ownership suppresses text menus and capability results retain no selection text', () => {
  const params = contextParams({
    isEditable: true,
    selectionText: 'must not persist',
    canCut: true,
    canCopy: true,
    canPaste: true
  });
  assert.equal(deriveTextContextMenuCapabilities(params, { suppress: true }), null);
  assert.equal(deriveTextContextMenuCapabilities(params, { textOwned: false }), null);
  assert.equal(
    deriveTextContextMenuCapabilities(contextParams(), { textOwned: true, owner: 'ordinary' }),
    null,
    'semantic ownership alone does not create an empty read-only menu'
  );

  const derived = deriveTextContextMenuCapabilities(params, {
    textOwned: true,
    owner: 'cne'
  });
  assert.equal(Object.hasOwn(derived, 'selectionText'), false);
  assert.equal(JSON.stringify(derived).includes(params.selectionText), false);
  assert.equal(Object.isFrozen(derived), true);
});

test('native templates expose only the capability-appropriate clipboard roles', () => {
  const selectedEditable = buildNativeTextContextMenuTemplate(contextParams({
    isEditable: true,
    selectionText: 'selection',
    canCut: true,
    canCopy: false,
    canPaste: true
  }), { platform: 'linux', hasValidFrame: true });
  assert.deepEqual(selectedEditable, [
    { role: 'cut', enabled: true },
    { role: 'copy', enabled: false },
    { role: 'paste', enabled: true }
  ]);

  const emptyEditable = buildNativeTextContextMenuTemplate(contextParams({
    isEditable: true,
    canCut: true,
    canCopy: true,
    canPaste: false
  }), { platform: 'darwin', hasValidFrame: true });
  assert.deepEqual(emptyEditable, [{ role: 'paste', enabled: false }]);

  const selectedReadOnly = buildNativeTextContextMenuTemplate(contextParams({
    selectionText: 'selection',
    canCut: true,
    canCopy: true,
    canPaste: true
  }), { platform: 'linux', hasValidFrame: true });
  assert.deepEqual(selectedReadOnly, [{ role: 'copy', enabled: true }]);

  assert.equal(buildNativeTextContextMenuTemplate(contextParams(), {
    platform: 'darwin',
    hasValidFrame: true
  }), null);
});

test('semantic cut and paste restrictions flow into one native visual menu', () => {
  const params = contextParams({
    isEditable: true,
    selectionText: 'selection',
    canCut: true,
    canCopy: true,
    canPaste: true
  });
  let lookUpCount = 0;
  const template = buildNativeTextContextMenuTemplate(params, {
    platform: 'darwin',
    hasValidFrame: true,
    onLookUp: () => {
      lookUpCount += 1;
    },
    semanticDescriptor: {
      textOwned: true,
      owner: 'markdown',
      canCut: false,
      canPaste: false
    }
  });
  assert.deepEqual(template.slice(0, 4), [
    { role: 'cut', enabled: false },
    { role: 'copy', enabled: true },
    { role: 'paste', enabled: false },
    { type: 'separator' }
  ]);
  assert.equal(template[4].label, 'Look Up');
  assert.equal(template[4].enabled, true);
  template[4].click();
  assert.equal(lookUpCount, 1);
  assert.deepEqual(template[5], { role: 'services' });
  assert.equal(buildNativeTextContextMenuTemplate(params, {
    platform: 'darwin',
    hasValidFrame: true,
    semanticDescriptor: { suppress: true }
  }), null);
  assert.equal(buildNativeTextContextMenuTemplate(params, {
    platform: 'darwin',
    hasValidFrame: true,
    semanticDescriptor: { textOwned: false }
  }), null);
});

test('macOS Look Up and Services require both selected text and a live originating frame', () => {
  const selected = contextParams({
    isEditable: true,
    selectionText: 'selection',
    canCut: true,
    canCopy: true,
    canPaste: true
  });
  assert.deepEqual(roles(buildNativeTextContextMenuTemplate(selected, {
    platform: 'darwin',
    hasValidFrame: true
  })), ['cut', 'copy', 'paste', '---', 'Look Up', 'services']);
  assert.deepEqual(roles(buildNativeTextContextMenuTemplate(selected, {
    platform: 'darwin',
    hasValidFrame: false
  })), ['cut', 'copy', 'paste']);
  assert.deepEqual(roles(buildNativeTextContextMenuTemplate(selected, {
    platform: 'win32',
    hasValidFrame: true
  })), ['cut', 'copy', 'paste']);
  assert.deepEqual(roles(buildNativeTextContextMenuTemplate(selected, {
    platform: 'linux',
    hasValidFrame: true
  })), ['cut', 'copy', 'paste']);

  const empty = contextParams({ isEditable: true, canPaste: true });
  assert.deepEqual(roles(buildNativeTextContextMenuTemplate(empty, {
    platform: 'darwin',
    hasValidFrame: true
  })), ['paste']);
  assert.equal(JSON.stringify(buildNativeTextContextMenuTemplate(selected, {
    platform: 'darwin',
    hasValidFrame: true
  })).includes('Translate'), false, 'Viewer must not invent a Translate menu item');
});

test('Look Up callback receives no selection payload and remains separate from Services', () => {
  let callArguments = null;
  const selectedText = 'word that must not be retained';
  const template = buildNativeTextContextMenuTemplate(contextParams({
    selectionText: selectedText,
    canCopy: true
  }), {
    platform: 'darwin',
    hasValidFrame: true,
    onLookUp(...args) {
      callArguments = args;
    }
  });
  const lookUp = template.find((item) => item.label === 'Look Up');
  assert.ok(lookUp);
  assert.ok(template.some((item) => item.role === 'services'));
  lookUp.click();
  assert.deepEqual(callArguments, []);
  assert.equal(JSON.stringify(template).includes(selectedText), false);
});

test('dismissing Look Up releases its renderer selection contract exactly once', () => {
  const postCloseScheduled = [];
  let releases = 0;
  const command = createNativeLookUpCommand({
    webContents: {
      isDestroyed: () => false,
      showDefinitionForSelection() {
        assert.fail('dismissal must not invoke Look Up');
      }
    },
    frame: { detached: false, isDestroyed: () => false },
    releaseSelection: () => {
      releases += 1;
    },
    schedule: (callback) => postCloseScheduled.push(callback)
  });

  assert.ok(command);
  assert.equal(command.afterPopupClosed(), false);
  assert.equal(releases, 1);
  assert.deepEqual(postCloseScheduled, []);
  assert.equal(command.afterPopupClosed(), false);
  assert.equal(command.cancel(), false);
  assert.equal(releases, 1, 'closed commands cannot release the same token twice');
});

test('Look Up waits for popup closure, invokes the payload-free API, then restores once', () => {
  const scheduled = [];
  const restoreScheduled = [];
  const definitionCalls = [];
  let restores = 0;
  let releases = 0;
  const frame = { detached: false, isDestroyed: () => false };
  const webContents = {
    isDestroyed: () => false,
    showDefinitionForSelection(...args) {
      definitionCalls.push(args);
    }
  };
  const command = createNativeLookUpCommand({
    webContents,
    frame,
    restoreSelection: () => {
      restores += 1;
      return true;
    },
    releaseSelection: () => {
      releases += 1;
    },
    schedule: (callback) => scheduled.push(callback),
    scheduleRestore: (callback) => restoreScheduled.push(callback)
  });

  assert.ok(command);
  assert.equal(command.request(), true);
  assert.equal(command.request(), false, 'repeated menu activation cannot duplicate the command');
  assert.deepEqual(definitionCalls, [], 'menu-item activation does not invoke AppKit while tracking');
  assert.equal(command.afterPopupClosed(), true);
  assert.equal(command.afterPopupClosed(), false, 'one activation cannot replay twice');
  assert.equal(scheduled.length, 1);
  assert.deepEqual(definitionCalls, [], 'popup closure still waits one main-loop turn');

  scheduled.shift()();
  assert.deepEqual(definitionCalls, [[]],
    'the originating WebContents receives a zero-argument Look Up call');
  assert.equal(restores, 0, 'selection restoration waits for the native overlay to settle');
  assert.equal(restoreScheduled.length, 1);
  assert.equal(releases, 0);

  const restore = restoreScheduled.shift();
  restore();
  restore();
  assert.equal(restores, 1, 'the renderer-local selection contract is one-shot');
  assert.equal(releases, 0, 'successful restoration consumes rather than releases the token');
});

test('deferred Look Up releases when its originating frame or WebContents becomes invalid', () => {
  for (const destroyedOwner of ['frame', 'webContents']) {
    const scheduled = [];
    const restoreScheduled = [];
    let definitionCalls = 0;
    let restoreCalls = 0;
    let releases = 0;
    let frameDestroyed = false;
    let webContentsDestroyed = false;
    const frame = { detached: false, isDestroyed: () => frameDestroyed };
    const webContents = {
      isDestroyed: () => webContentsDestroyed,
      showDefinitionForSelection() {
        definitionCalls += 1;
      }
    };
    const command = createNativeLookUpCommand({
      webContents,
      frame,
      restoreSelection: () => {
        restoreCalls += 1;
        return true;
      },
      releaseSelection: () => {
        releases += 1;
      },
      schedule: (callback) => scheduled.push(callback),
      scheduleRestore: (callback) => restoreScheduled.push(callback)
    });
    command.request();
    command.afterPopupClosed();
    if (destroyedOwner === 'frame') frameDestroyed = true;
    else webContentsDestroyed = true;
    scheduled.shift()();
    assert.equal(definitionCalls, 0, `${destroyedOwner} invalidation cancels Look Up`);
    assert.equal(restoreCalls, 0);
    assert.equal(releases, 1, `${destroyedOwner} invalidation releases the renderer token`);
    assert.deepEqual(restoreScheduled, []);
  }

  for (const destroyedOwner of ['frame', 'webContents']) {
    const scheduled = [];
    const restoreScheduled = [];
    let releases = 0;
    let restores = 0;
    let frameDestroyed = false;
    let webContentsDestroyed = false;
    const frame = { detached: false, isDestroyed: () => frameDestroyed };
    const command = createNativeLookUpCommand({
      webContents: {
        isDestroyed: () => webContentsDestroyed,
        showDefinitionForSelection() {}
      },
      frame,
      restoreSelection: () => {
        restores += 1;
        return true;
      },
      releaseSelection: () => {
        releases += 1;
      },
      schedule: (callback) => scheduled.push(callback),
      scheduleRestore: (callback) => restoreScheduled.push(callback)
    });
    command.request();
    command.afterPopupClosed();
    scheduled.shift()();
    assert.equal(restoreScheduled.length, 1);
    if (destroyedOwner === 'frame') frameDestroyed = true;
    else webContentsDestroyed = true;
    restoreScheduled.shift()();
    assert.equal(restores, 0);
    assert.equal(releases, 1,
      `${destroyedOwner} invalidation during overlay display releases the renderer token`);
  }
});

test('Look Up API failure and explicit cancellation finalize selection ownership once', () => {
  const scheduled = [];
  let releases = 0;
  const command = createNativeLookUpCommand({
    webContents: {
      isDestroyed: () => false,
      showDefinitionForSelection() {
        throw new Error('native Dictionary unavailable');
      }
    },
    frame: { detached: false, isDestroyed: () => false },
    restoreSelection: () => assert.fail('failed Look Up must not schedule restoration'),
    releaseSelection: () => {
      releases += 1;
    },
    schedule: (callback) => scheduled.push(callback),
    scheduleRestore: () => assert.fail('failed Look Up must not schedule restoration')
  });
  command.request();
  command.afterPopupClosed();
  scheduled.shift()();
  assert.equal(releases, 1);
  assert.equal(command.cancel(), false);
  assert.equal(releases, 1);

  let cancelledReleases = 0;
  const cancelled = createNativeLookUpCommand({
    webContents: {
      isDestroyed: () => false,
      showDefinitionForSelection: () => assert.fail('cancelled command must not invoke Look Up')
    },
    frame: { detached: false, isDestroyed: () => false },
    releaseSelection: () => {
      cancelledReleases += 1;
    }
  });
  assert.equal(cancelled.cancel(), true);
  assert.equal(cancelled.cancel(), false);
  assert.equal(cancelled.afterPopupClosed(), false);
  assert.equal(cancelledReleases, 1);

  const postCloseScheduled = [];
  let scheduledReleases = 0;
  let scheduledDefinitions = 0;
  const cancelledAfterClose = createNativeLookUpCommand({
    webContents: {
      isDestroyed: () => false,
      showDefinitionForSelection() {
        scheduledDefinitions += 1;
      }
    },
    frame: { detached: false, isDestroyed: () => false },
    releaseSelection: () => {
      scheduledReleases += 1;
    },
    schedule: (callback) => postCloseScheduled.push(callback)
  });
  cancelledAfterClose.request();
  cancelledAfterClose.afterPopupClosed();
  assert.equal(cancelledAfterClose.cancel(), true,
    'navigation may cancel after popup closure but before the next main-loop turn');
  postCloseScheduled.shift()();
  assert.equal(scheduledDefinitions, 0);
  assert.equal(scheduledReleases, 1);
});

test('failed async restoration and scheduler errors release without replay', async () => {
  const scheduled = [];
  const restoreScheduled = [];
  let releases = 0;
  const command = createNativeLookUpCommand({
    webContents: {
      isDestroyed: () => false,
      showDefinitionForSelection() {}
    },
    frame: { detached: false, isDestroyed: () => false },
    restoreSelection: async () => false,
    releaseSelection: async () => {
      releases += 1;
      throw new Error('renderer already navigated');
    },
    schedule: (callback) => scheduled.push(callback),
    scheduleRestore: (callback) => restoreScheduled.push(callback)
  });
  command.request();
  command.afterPopupClosed();
  scheduled.shift()();
  restoreScheduled.shift()();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(releases, 1,
    'a false async restore triggers one best-effort release with rejection handled');

  let schedulerReleases = 0;
  const schedulingFailure = createNativeLookUpCommand({
    webContents: {
      isDestroyed: () => false,
      showDefinitionForSelection() {}
    },
    frame: { detached: false, isDestroyed: () => false },
    releaseSelection: () => {
      schedulerReleases += 1;
    },
    schedule() {
      throw new Error('scheduler unavailable');
    }
  });
  schedulingFailure.request();
  assert.equal(schedulingFailure.afterPopupClosed(), true);
  assert.equal(schedulerReleases, 1);
});

test('context-menu frames reject null, destroyed, detached, and exceptional handles', () => {
  const live = { detached: false, isDestroyed: () => false };
  assert.strictEqual(validContextMenuFrame(live), live);
  assert.equal(validContextMenuFrame(null), null);
  assert.equal(validContextMenuFrame({}), null);
  assert.equal(validContextMenuFrame({ isDestroyed: () => true }), null);
  assert.equal(validContextMenuFrame({ detached: true, isDestroyed: () => false }), null);
  assert.equal(validContextMenuFrame({
    isDestroyed() {
      throw new Error('frame navigated');
    }
  }), null);
  assert.equal(validContextMenuFrame({
    isDestroyed: () => false,
    get detached() {
      throw new Error('frame detached');
    }
  }), null);
});

test('desktop wiring observes every Viewer webContents and pops against params.frame', async () => {
  const main = await fs.readFile(path.join(PROJECT_ROOT, 'desktop/main.js'), 'utf8');
  assert.match(main, /app\.on\(['"]web-contents-created['"]/);
  assert.match(main, /\.on\(['"]context-menu['"]/);
  assert.match(main, /validContextMenuFrame\(params\.frame\)/);
  assert.match(main, /popupOptions\.frame\s*=\s*frame/);
  assert.match(main, /const selectionToken\s*=\s*rendererLookUpSelectionToken\(/);
  assert.match(main, /rendererLookUpSelectionAction\(frame, ['"]claim['"], selectionToken\)/);
  assert.match(main, /const releaseSelection\s*=\s*\(\)\s*=>\s*selectionToken[^]*?rendererLookUpSelectionAction\(params\?\.frame, ['"]release['"], selectionToken\)/);
  assert.match(main, /createNativeLookUpCommand\(\{[^]*?webContents,[^]*?frame,[^]*?restoreSelection:\s*\(\)\s*=>\s*rendererLookUpSelectionAction\([^]*?frame, ['"]restore['"], selectionToken[^]*?releaseSelection[^]*?\}\)/);
  assert.match(main, /executeJavaScript\([^]*?nativeContextMenu\?\.\$\{method\}\(\$\{safeToken\}\) === true/);
  assert.match(main, /popupOptions\.callback\s*=\s*\(\)\s*=>\s*lookUpCommand\.afterPopupClosed\(\)/);
  assert.match(main, /lookUpCommand\?\.cancel\(\)/);
  assert.match(main, /\.popup\(popupOptions\)/);
  const nativeMenu = await fs.readFile(
    path.join(PROJECT_ROOT, 'desktop/nativeContextMenu.js'),
    'utf8'
  );
  assert.match(nativeMenu, /webContents\.showDefinitionForSelection\(\)/);
  assert.match(nativeMenu, /scheduleRestore\s*=\s*\(callback\)\s*=>\s*setTimeout\(callback, 1000\)/);
  assert.match(nativeMenu, /restoreSelection\?\.\(\)/);
  assert.match(nativeMenu, /releaseSelection\?\.\(\)/);
  assert.match(nativeMenu, /validContextMenuFrame\(originatingFrame\) !== originatingFrame/);
  assert.doesNotMatch(main, /(?:cached|global|last|current)(?:ContextMenu)?Frame\s*=\s*params\.frame/i);
});

test('renderer capture precedence protects canonical text-selection owners', async () => {
  const renderer = await fs.readFile(path.join(PROJECT_ROOT, 'public/nativeContextMenu.js'), 'utf8');
  assert.match(renderer, /document\?\.addEventListener\?\.\(['"]contextmenu['"][^]*?true\s*\)/);
  assert.match(renderer, /stopImmediatePropagation\?\.\(\)/);
  assert.match(renderer, /textOwned\s*:\s*(?:true|false)/);
  assert.match(renderer, /restoreLookUpSelection/);
  assert.match(renderer, /claimLookUpSelection/);
  assert.match(renderer, /releaseLookUpSelection/);
  assert.match(renderer, /lookUpSelectionToken/);
  assert.doesNotMatch(renderer, /event\?\.detail\s*===\s*0/);
  assert.doesNotMatch(renderer, /(?:localStorage|sessionStorage|fetch)\s*\([^)]*(?:selection|selectedText)/i);
  assert.doesNotMatch(renderer, /console\.(?:log|info|warn|error|debug)\([^)]*(?:selectionText|selection\.toString)/i);
});

test('renderer Look Up tokens restore directional control selections exactly once', async () => {
  const focusCalls = [];
  const restoreCalls = [];
  const privateValue = 'private directional selection must stay renderer-local';
  const input = fakeElement();
  Object.assign(input, {
    tagName: 'INPUT',
    type: 'text',
    value: privateValue,
    selectionStart: 3,
    selectionEnd: 14,
    selectionDirection: 'backward',
    isConnected: true,
    hasAttribute: () => false,
    getAttribute: () => 'text',
    focus(options) {
      focusCalls.push(options);
    },
    setSelectionRange(start, end, direction) {
      restoreCalls.push([start, end, direction]);
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction;
    },
    closest(selector) {
      return selector === 'input, textarea' ? this : null;
    }
  });
  const { api, contextMenuListener } = await loadRendererContextMenu();
  contextMenuListener({
    target: input,
    button: 2,
    clientX: 21,
    clientY: 34,
    stopImmediatePropagation() {}
  });
  const descriptor = api.describeTextContextMenu({
    x: 21,
    y: 34,
    menuSourceType: 'mouse'
  });
  const token = descriptor.lookUpSelectionToken;

  assert.equal(Number.isSafeInteger(token) && token > 0, true);
  assert.equal(JSON.stringify(descriptor).includes(privateValue), false,
    'the opaque descriptor contains no selected value or text');
  assert.equal(api.claimLookUpSelection(token), true);
  assert.equal(api.claimLookUpSelection(token), false, 'claim is one-shot');
  const replayDescriptor = api.describeTextContextMenu({
    x: 21,
    y: 34,
    menuSourceType: 'mouse'
  });
  assert.equal(Object.hasOwn(replayDescriptor, 'lookUpSelectionToken'), false,
    'a claimed token cannot reappear from the cached descriptor');
  input.selectionStart = 0;
  input.selectionEnd = 0;
  input.selectionDirection = 'none';
  assert.equal(api.restoreLookUpSelection(token), true);
  assert.deepEqual(restoreCalls, [[3, 14, 'backward']]);
  assert.equal(focusCalls.length, 1);
  assert.equal(focusCalls[0].preventScroll, true);
  assert.equal(input.selectionDirection, 'backward');
  assert.equal(api.restoreLookUpSelection(token), false, 'restoration consumes the token');
  assert.equal(api.releaseLookUpSelection(token), false, 'a consumed token cannot be released');
});

test('renderer Look Up token release and replacement invalidate stale contracts', async () => {
  const input = fakeElement();
  Object.assign(input, {
    tagName: 'TEXTAREA',
    selectionStart: 1,
    selectionEnd: 4,
    selectionDirection: 'forward',
    isConnected: true,
    hasAttribute: () => false,
    getAttribute: () => null,
    focus() {},
    setSelectionRange(start, end, direction) {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction;
    },
    closest(selector) {
      return selector === 'input, textarea' ? this : null;
    }
  });
  const { api, contextMenuListener } = await loadRendererContextMenu();
  const remember = (x) => {
    contextMenuListener({
      target: input,
      button: 2,
      clientX: x,
      clientY: 10,
      stopImmediatePropagation() {}
    });
    return api.describeTextContextMenu({ x, y: 10, menuSourceType: 'mouse' });
  };

  const first = remember(10).lookUpSelectionToken;
  input.selectionStart = 5;
  input.selectionEnd = 9;
  input.selectionDirection = 'backward';
  const second = remember(20).lookUpSelectionToken;
  assert.notEqual(second, first);
  assert.equal(api.restoreLookUpSelection(first), false,
    'a newer context invalidates the previous renderer-local contract');
  assert.equal(api.claimLookUpSelection(second), true);
  assert.equal(api.releaseLookUpSelection(second), true);
  assert.equal(api.releaseLookUpSelection(second), false, 'release is one-shot');
  assert.equal(api.restoreLookUpSelection(second), false);
  assert.equal(api.releaseLookUpSelection(0), false);
  assert.equal(api.releaseLookUpSelection(Number.MAX_SAFE_INTEGER + 1), false);
});

test('unclaimed renderer Look Up offers expire and pagehide consumes claimed tokens', async () => {
  const timerCallbacks = new Map();
  const clearedTimers = [];
  let nextTimer = 1;
  const input = fakeElement();
  Object.assign(input, {
    tagName: 'INPUT',
    type: 'text',
    selectionStart: 2,
    selectionEnd: 6,
    selectionDirection: 'forward',
    isConnected: true,
    hasAttribute: () => false,
    getAttribute: () => 'text',
    focus() {},
    setSelectionRange(start, end, direction) {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction;
    },
    closest(selector) {
      return selector === 'input, textarea' ? this : null;
    }
  });
  const harness = await loadRendererContextMenu({
    setTimeoutFn(callback, delay) {
      assert.equal(delay, 2000);
      const id = nextTimer;
      nextTimer += 1;
      timerCallbacks.set(id, callback);
      return id;
    },
    clearTimeoutFn(id) {
      clearedTimers.push(id);
      timerCallbacks.delete(id);
    }
  });
  const remember = (x) => {
    harness.contextMenuListener({
      target: input,
      button: 2,
      clientX: x,
      clientY: 12,
      stopImmediatePropagation() {}
    });
    return harness.api.describeTextContextMenu({
      x,
      y: 12,
      menuSourceType: 'mouse'
    }).lookUpSelectionToken;
  };

  const expiredToken = remember(12);
  timerCallbacks.get(1)();
  assert.equal(harness.api.claimLookUpSelection(expiredToken), false);
  assert.equal(harness.api.releaseLookUpSelection(expiredToken), false);

  const pagehideToken = remember(24);
  assert.equal(harness.api.claimLookUpSelection(pagehideToken), true);
  assert.ok(clearedTimers.includes(2), 'claim cancels the offered-token expiry timer');
  harness.windowListeners.get('pagehide')();
  assert.equal(harness.api.restoreLookUpSelection(pagehideToken), false,
    'renderer teardown cannot replay a claimed selection contract');
});

test('Markdown Look Up restoration delegates to the existing editable selection owner', async () => {
  const selectionBookmark = {
    anchor: { offset: 17 },
    focus: { offset: 4 }
  };
  const captures = [];
  const restores = [];
  const focusCalls = [];
  const body = fakeElement();
  Object.assign(body, {
    isConnected: true,
    hasAttribute: () => false,
    getAttribute: (name) => name === 'contenteditable' ? 'true' : null,
    focus(options) {
      focusCalls.push(options);
    },
    closest(selector) {
      if (selector === '[contenteditable]' || selector === '.markdown-page-body') return this;
      return null;
    }
  });
  const markdownPageView = {
    editableSelection(owner) {
      captures.push(owner);
      return selectionBookmark;
    },
    restoreEditableSelection(owner, bookmark) {
      restores.push([owner, bookmark]);
      return true;
    }
  };
  const { api, contextMenuListener } = await loadRendererContextMenu({ markdownPageView });
  contextMenuListener({
    target: body,
    button: 2,
    clientX: 44,
    clientY: 55,
    stopImmediatePropagation() {}
  });
  const descriptor = api.describeTextContextMenu({
    x: 44,
    y: 55,
    menuSourceType: 'mouse'
  });

  assert.equal(descriptor.owner, 'markdown');
  assert.deepEqual(captures, [body]);
  assert.equal(api.claimLookUpSelection(descriptor.lookUpSelectionToken), true);
  assert.equal(api.restoreLookUpSelection(descriptor.lookUpSelectionToken), true);
  assert.deepEqual(restores, [[body, selectionBookmark]]);
  assert.equal(focusCalls.length, 1);
  assert.equal(focusCalls[0].preventScroll, true);
});

test('Reading Look Up restoration preserves browser Range anchor/focus direction', async () => {
  const anchorNode = { isConnected: true };
  const focusNode = { isConnected: true };
  const range = {
    intersectsNode: () => true,
    getClientRects: () => [{ left: 10, right: 70, top: 10, bottom: 30 }]
  };
  const restored = [];
  const selection = {
    isCollapsed: false,
    rangeCount: 1,
    anchorNode,
    anchorOffset: 12,
    focusNode,
    focusOffset: 2,
    getRangeAt: () => range,
    toString: () => 'backward reading selection',
    setBaseAndExtent(...args) {
      restored.push(args);
      this.isCollapsed = false;
    }
  };
  const bodyFocus = [];
  const body = {
    isConnected: true,
    focus(options) {
      bodyFocus.push(options);
    }
  };
  const target = fakeElement();
  target.closest = (selector) => {
    if (selector === '.markdown-page-body'
      || selector === '[contenteditable],.markdown-page-body') return body;
    return null;
  };
  const { api, contextMenuListener } = await loadRendererContextMenu({ selection });
  contextMenuListener({
    target,
    button: 2,
    clientX: 30,
    clientY: 20,
    stopImmediatePropagation() {}
  });
  const descriptor = api.describeTextContextMenu({
    x: 30,
    y: 20,
    menuSourceType: 'mouse'
  });
  selection.isCollapsed = true;

  assert.equal(descriptor.owner, 'markdown');
  assert.equal(api.claimLookUpSelection(descriptor.lookUpSelectionToken), true);
  assert.equal(api.restoreLookUpSelection(descriptor.lookUpSelectionToken), true);
  assert.deepEqual(restored, [[anchorNode, 12, focusNode, 2]],
    'setBaseAndExtent retains backward anchor/focus ordering');
  assert.equal(bodyFocus.length, 1);
  assert.equal(bodyFocus[0].preventScroll, true);
});

test('HN Look Up restoration delegates to its existing selection contract', async () => {
  const anchorNode = { isConnected: true };
  const focusNode = { isConnected: true };
  let browserRestoreCalls = 0;
  const range = {
    intersectsNode: () => true,
    getClientRects: () => [{ left: 10, right: 70, top: 10, bottom: 30 }]
  };
  const selection = {
    isCollapsed: false,
    rangeCount: 1,
    anchorNode,
    anchorOffset: 1,
    focusNode,
    focusOffset: 8,
    getRangeAt: () => range,
    toString: () => 'HN selection',
    setBaseAndExtent() {
      browserRestoreCalls += 1;
    }
  };
  const editor = fakeElement();
  Object.assign(editor, {
    isConnected: true,
    hasAttribute: () => false,
    getAttribute: (name) => name === 'contenteditable' ? 'true' : null,
    closest(selector) {
      if (selector === '[contenteditable]'
        || selector === '.hn-source-editor') return this;
      return null;
    }
  });
  const hnCaptures = [];
  const hnRestores = [];
  const hnTextPageView = {
    captureHnTextSelection(target) {
      hnCaptures.push(target);
      return true;
    },
    reassertHnTextSelection(target) {
      hnRestores.push(target);
      return true;
    }
  };
  const { api, contextMenuListener } = await loadRendererContextMenu({
    selection,
    hnTextPageView
  });
  contextMenuListener({
    target: editor,
    button: 2,
    clientX: 30,
    clientY: 20
  });
  const descriptor = api.describeTextContextMenu({
    x: 30,
    y: 20,
    menuSourceType: 'mouse'
  });

  assert.equal(descriptor.owner, 'cne');
  assert.equal(api.claimLookUpSelection(descriptor.lookUpSelectionToken), true);
  assert.deepEqual(hnCaptures, [editor]);
  assert.equal(api.restoreLookUpSelection(descriptor.lookUpSelectionToken), true);
  assert.deepEqual(hnRestores, [editor]);
  assert.equal(browserRestoreCalls, 0,
    'HN remains the sole owner instead of falling back to a second browser Range owner');
});

test('renderer precedence yields exact selected glyphs but not other domain regions', async () => {
  const target = fakeElement();
  const snappedPoint = { node: {}, offset: 2 };
  const range = {
    intersectsNode: (node) => node === target,
    isPointInRange: (node, offset) => node === snappedPoint.node && offset === 2,
    getClientRects: () => [{ left: 10, right: 40, top: 10, bottom: 30 }]
  };
  const selection = {
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => range,
    toString: () => 'selected glyphs'
  };
  const { contextMenuListener } = await loadRendererContextMenu({
    selection,
    point: snappedPoint
  });

  const dispatch = (overrides) => {
    const calls = { prevented: 0, stopped: 0 };
    contextMenuListener({
      target,
      button: 2,
      clientX: 20,
      clientY: 20,
      detail: 0,
      preventDefault: () => { calls.prevented += 1; },
      stopImmediatePropagation: () => { calls.stopped += 1; },
      ...overrides
    });
    return calls;
  };

  assert.deepEqual(dispatch({}), { prevented: 0, stopped: 1 },
    'actual selected glyphs yield to the native text menu');
  assert.deepEqual(dispatch({ clientX: 90, clientY: 90 }), {
    prevented: 0,
    stopped: 0
  }, 'a snapped in-range caret outside selected glyphs does not steal a domain menu');
  assert.deepEqual(dispatch({ button: 0, clientX: 0, clientY: 0 }), {
    prevented: 0,
    stopped: 1
  }, 'keyboard context-menu invocation can use the focused selected range');
});

test('renderer precedence treats ordinary controls as text', async () => {
  const { api } = await loadRendererContextMenu();
  const input = fakeElement();
  input.tagName = 'INPUT';
  input.type = 'text';
  input.selectionStart = 1;
  input.selectionEnd = 4;
  input.hasAttribute = () => false;
  input.getAttribute = () => 'text';
  input.closest = (selector) => selector === 'input, textarea' ? input : null;
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.classifyTextContext(input, {
      x: 15,
      y: 15,
      menuSourceType: 'mouse'
    }))),
    { textOwned: true, owner: 'ordinary', editable: true }
  );
});

test('HN text settles its canonical source editor while Canvas yields', async () => {
  const commits = [];
  const hnTextPageView = {
    commitFocusedHnTextEditor(target) {
      commits.push(target);
      return true;
    }
  };
  const { api, contextMenuListener } = await loadRendererContextMenu({ hnTextPageView });
  const editor = fakeElement();
  editor.getAttribute = (name) => name === 'contenteditable' ? 'true' : null;
  editor.hasAttribute = () => false;
  editor.closest = (selector) => (
    selector === '[contenteditable]' || selector === '.hn-source-editor'
      ? editor
      : null
  );
  const calls = { prevented: 0, stopped: 0 };
  const event = {
    target: editor,
    button: 2,
    clientX: 15,
    clientY: 15,
    preventDefault: () => { calls.prevented += 1; },
    stopImmediatePropagation: () => { calls.stopped += 1; }
  };
  contextMenuListener(event);
  assert.deepEqual(calls, { prevented: 0, stopped: 0 });
  assert.deepEqual(commits, [editor]);
  assert.equal(api.ownsTextContextEvent(event), true);

  const bootstrap = await fs.readFile(
    path.join(PROJECT_ROOT, 'public/js/appBootstrap.js'),
    'utf8'
  );
  assert.match(
    bootstrap,
    /area\.addEventListener\(['"]contextmenu['"][^]*?nativeContextMenu\?\.ownsTextContextEvent\?\.\(event\)[^]*?return/
  );
});

test('Markdown table padding retains structural ownership while actual cell text is textual', async () => {
  const snappedPoint = { node: {}, offset: 2 };
  const range = {
    intersectsNode: () => true,
    isPointInRange: (node, offset) => node === snappedPoint.node && offset === 2,
    getClientRects: () => [{ left: 10, right: 40, top: 10, bottom: 30 }]
  };
  const selection = {
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => range,
    toString: () => 'selected cell text'
  };
  const { api } = await loadRendererContextMenu({ selection, point: snappedPoint });
  const cell = fakeElement();
  cell.getAttribute = (name) => name === 'contenteditable' ? 'true' : null;
  cell.hasAttribute = () => false;
  cell.closest = (selector) => (
    selector === '[contenteditable]'
      || selector === '[data-markdown-editable-table-cell]'
      || selector === '.markdown-page-body'
      ? cell
      : null
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.classifyTextContext(cell, {
      x: 80,
      y: 80,
      menuSourceType: 'mouse'
    }))),
    { textOwned: false }
  );

  const glyph = fakeElement();
  glyph.closest = (selector) => (
    selector === '[contenteditable]'
      || selector === '[data-markdown-editable-table-cell]'
      || selector === '.markdown-page-body'
      ? cell
      : null
  );
  assert.equal(api.classifyTextContext(glyph, {
    x: 20,
    y: 20,
    menuSourceType: 'mouse'
  }).textOwned, true);
});

test('Markdown and HN clipboard events remain routed through canonical transaction owners', async () => {
  const [markdown, cne, sourceEditor, hnSession] = await Promise.all([
    fs.readFile(path.join(PROJECT_ROOT, 'public/js/markdownPageView.js'), 'utf8'),
    fs.readFile(path.join(PROJECT_ROOT, 'public/js/hnTextPageView.js'), 'utf8'),
    fs.readFile(path.join(PROJECT_ROOT, 'public/js/sourceCanonicalEditor.js'), 'utf8'),
    fs.readFile(path.join(PROJECT_ROOT, 'public/js/hnPageDocumentSession.js'), 'utf8')
  ]);

  assert.match(markdown, /function handleMarkdownClipboardEvent\(event, operation\)/);
  assert.match(markdown, /function handleMarkdownPasteEvent\(event\)/);
  assert.match(markdown, /document\.addEventListener\(['"]copy['"][^]*?handleMarkdownClipboardEvent\(event, ['"]copy['"]\)[^]*?true\s*\)/);
  assert.match(markdown, /document\.addEventListener\(['"]cut['"][^]*?handleMarkdownClipboardEvent\(event, ['"]cut['"]\)[^]*?true\s*\)/);
  assert.match(markdown, /document\.addEventListener\(['"]paste['"],\s*handleMarkdownPasteEvent,\s*true\s*\)/);
  assert.match(markdown, /replaceSemanticSourceRange\(/);

  assert.match(cne, /createSourceCanonicalEditor\(\{/);
  assert.match(sourceEditor, /_copy\(event, \{ cut = false \} = \{\}\)/);
  assert.match(sourceEditor, /_paste\(event\)/);
  assert.match(sourceEditor, /this\.session\.applySourceTransaction\(/);
  assert.match(sourceEditor, /this\._listen\(this\.root, ['"]copy['"][^]*?this\._copy\(event\)/);
  assert.match(sourceEditor, /this\._listen\(this\.root, ['"]cut['"][^]*?this\._copy\(event, \{ cut: true \}\)/);
  assert.match(sourceEditor, /this\._listen\(this\.root, ['"]paste['"][^]*?this\._paste\(event\)/);
  assert.match(hnSession, /class HnPageDocumentSession/);
});
