const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell
} = require('electron');
const {
  MAX_ZOOM_SENSITIVITY,
  MIN_ZOOM_SENSITIVITY,
  createDesktopSettings,
  explicitNavigationSortModeForVault,
  folderRootsForVault,
  migrateLegacyZoomSensitivities,
  navigationSortModeForVault,
  setExternalFileTarget,
  withFolderRootsForVault,
  withZoomSensitivityForVault,
  withNavigationSortMode,
  workspaceRootsForVault,
  zoomSensitivityForVault
} = require('./desktopSettings');
const { ensureCurrentVault } = require('../server/vaultContext');
const {
  createRegisteredVault,
  listRegisteredVaults,
  renameRegisteredVault,
  selectRegisteredVault,
  validateRegisteredVault
} = require('../server/vaultRegistry');
const {
  migrateVaultWorkspaceStateNavigationSort,
  updateVaultWorkspaceState
} = require('../server/vaultWorkspaceState');
const { loadNavigationSortModeOwner } = require('./navigationSortOwner');
const { createResourceActions } = require('./resourceActions');
const { createFolderFileService } = require('./folderFileService');
const { executeAddFiles } = require('./addFileController');
const { createFolderService } = require('./folderService');
const {
  FolderMaintenanceError,
  createFolderMaintenanceService
} = require('./folderMaintenanceService');
const {
  normalizeResourceLocationInput,
  resolveResourceLocation
} = require('./vaultPaths');
const {
  readWorkspaceDefinitions
} = require('./workspaceDefinitions');
const { readFolderRegistry, writeFolderRegistry } = require('./folderRegistry');
const { createFontService } = require('./fontService');
const {
  buildNativeContextMenuTemplate,
  buildNativeTextContextMenuTemplate,
  createNativeLookUpCommand,
  validContextMenuFrame
} = require('./nativeContextMenu');
const { createDisplayProxyService } = require('./displayProxyService');
const { createExternalLinkActions } = require('./externalLinkActions');
const { createManagedResourceRelocator } = require('./managedResourceRelocator');
const { createVaultServerContext } = require('../server/appServer');

const execFileAsync = promisify(execFile);

const APP_NAME = 'Reductionism & Emergence';
const VOCABULARY_DEFAULT_WINDOW_WIDTH = 820;
const DEFAULT_CHILD_WINDOW_WIDTH = 980;
const IPC = Object.freeze({
  GET_VAULT_INFO: 'cne-desktop:get-vault-info',
  CREATE_VAULT: 'cne-desktop:create-vault',
  RENAME_VAULT: 'cne-desktop:rename-vault',
  SWITCH_VAULT: 'cne-desktop:switch-vault',
  GET_CONTROL_SETTINGS: 'cne-desktop:get-control-settings',
  SET_ZOOM_SENSITIVITY: 'cne-desktop:set-zoom-sensitivity',
  GET_NAVIGATION_SORT_MODE: 'cne-desktop:get-navigation-sort-mode',
  SET_NAVIGATION_SORT_MODE: 'cne-desktop:set-navigation-sort-mode',
  GET_WORKSPACE_STATE: 'cne-desktop:get-workspace-state',
  SET_WORKSPACE_STATE: 'cne-desktop:set-workspace-state',
  LIST_SYSTEM_FONTS: 'cne-desktop:list-system-fonts',
  ADD_DROPPED_FILES: 'cne-desktop:add-dropped-files',
  ADD_FILES: 'cne-desktop:add-files',
  GET_RESOURCE_FOLDERS: 'cne-desktop:get-resource-folders',
  SELECT_DEFAULT_FOLDER: 'cne-desktop:select-default-folder',
  ADD_READ_ONLY_FOLDER: 'cne-desktop:add-read-only-folder',
  CHANGE_READ_ONLY_FOLDER: 'cne-desktop:change-read-only-folder',
  REMOVE_READ_ONLY_FOLDER: 'cne-desktop:remove-read-only-folder',
  SET_DEFAULT_FOLDER: 'cne-desktop:set-default-folder',
  RELINK_FOLDER: 'cne-desktop:relink-folder',
  OPEN_RESOURCE: 'cne-desktop:open-vault-resource',
  REVEAL_RESOURCE: 'cne-desktop:reveal-vault-resource',
  SELECT_EXTERNAL_LINK_FILE: 'cne-desktop:select-external-link-file',
  REGISTER_DROPPED_EXTERNAL_LINK_FILE: 'cne-desktop:register-dropped-external-link-file',
  DESCRIBE_EXTERNAL_LINK_FILE: 'cne-desktop:describe-external-link-file',
  OPEN_EXTERNAL_LINK_TARGET: 'cne-desktop:open-external-link-target',
  WRITE_CLIPBOARD_TEXT: 'cne-desktop:write-clipboard-text',
  SHOW_CONTEXT_MENU: 'cne-desktop:show-context-menu',
  RESOLVE_MANAGED_RESOURCE: 'cne-desktop:resolve-managed-resource',
  REQUEST_DISPLAY_PROXY: 'cne-desktop:request-display-proxy'
});

let settingsStore = null;
let quitFlushPending = false;
let quittingForServerClose = false;
let desktopSettingsMutationQueue = Promise.resolve();
let registryMutationQueue = Promise.resolve();
let lastFocusedVaultId = null;
const vaultRuntimes = new Map();
const runtimeByWebContentsId = new Map();
const openingVaults = new Map();
const closingVaultServers = new Map();
const vaultLifecycleOperations = new Set();
const vaultLifecycleQueues = new Map();
const fontService = createFontService();
const textContextMenuWebContents = new WeakSet();
const textContextMenuRequestGeneration = new WeakMap();
const textContextMenuLookUpCommands = new WeakMap();

function textContextDescriptorSource(params) {
  const facts = {
    x: Number.isFinite(params?.x) ? params.x : 0,
    y: Number.isFinite(params?.y) ? params.y : 0,
    isEditable: params?.isEditable === true,
    hasSelection: typeof params?.selectionText === 'string' && params.selectionText.length > 0,
    menuSourceType: typeof params?.menuSourceType === 'string'
      ? params.menuSourceType
      : 'none'
  };
  return `globalThis.nativeContextMenu?.describeTextContextMenu(${JSON.stringify(facts)}) ?? null`;
}

async function rendererTextContextDescriptor(params) {
  const frame = validContextMenuFrame(params?.frame);
  if (!frame) return null;
  try {
    return await frame.executeJavaScript(textContextDescriptorSource(params), true);
  } catch {
    return null;
  }
}

function rendererLookUpSelectionToken(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function rendererLookUpSelectionAction(frame, action, token) {
  const originatingFrame = validContextMenuFrame(frame);
  const safeToken = rendererLookUpSelectionToken(token);
  const method = action === 'claim'
    ? 'claimLookUpSelection'
    : action === 'restore'
    ? 'restoreLookUpSelection'
    : action === 'release'
      ? 'releaseLookUpSelection'
      : null;
  if (!originatingFrame || !safeToken || !method) return false;
  try {
    return await originatingFrame.executeJavaScript(
      `globalThis.nativeContextMenu?.${method}(${safeToken}) === true`,
      true
    ) === true;
  } catch {
    return false;
  }
}

function installNativeTextContextMenu(webContents) {
  if (!webContents || textContextMenuWebContents.has(webContents)) return;
  textContextMenuWebContents.add(webContents);
  const cancelActiveLookUpCommand = () => {
    const activeCommand = textContextMenuLookUpCommands.get(webContents);
    if (!activeCommand) return false;
    textContextMenuLookUpCommands.delete(webContents);
    return activeCommand.cancel();
  };
  webContents.on('did-start-navigation', cancelActiveLookUpCommand);
  webContents.on('render-process-gone', cancelActiveLookUpCommand);
  webContents.on('destroyed', cancelActiveLookUpCommand);
  webContents.on('context-menu', async (event, params) => {
    cancelActiveLookUpCommand();
    const generation = (textContextMenuRequestGeneration.get(webContents) || 0) + 1;
    textContextMenuRequestGeneration.set(webContents, generation);
    const hasSelection = typeof params?.selectionText === 'string'
      && params.selectionText.length > 0;
    if (params?.isEditable !== true && !hasSelection) return;

    const semanticDescriptor = await rendererTextContextDescriptor(params);
    const selectionToken = rendererLookUpSelectionToken(
      semanticDescriptor?.lookUpSelectionToken
    );
    const releaseSelection = () => selectionToken
      ? rendererLookUpSelectionAction(params?.frame, 'release', selectionToken)
      : false;
    if (textContextMenuRequestGeneration.get(webContents) !== generation
      || webContents.isDestroyed?.()) {
      void releaseSelection();
      return;
    }
    const frame = validContextMenuFrame(params.frame);
    const selectionClaimed = process.platform === 'darwin' && selectionToken && frame
      ? await rendererLookUpSelectionAction(frame, 'claim', selectionToken)
      : false;
    if (textContextMenuRequestGeneration.get(webContents) !== generation
      || webContents.isDestroyed?.()
      || (frame && validContextMenuFrame(frame) !== frame)) {
      void releaseSelection();
      return;
    }
    const lookUpCommand = selectionClaimed
      ? createNativeLookUpCommand({
          webContents,
          frame,
          restoreSelection: () => rendererLookUpSelectionAction(
            frame, 'restore', selectionToken
          ),
          releaseSelection
        })
      : null;
    if (lookUpCommand) textContextMenuLookUpCommands.set(webContents, lookUpCommand);
    if (!lookUpCommand && selectionToken) {
      void rendererLookUpSelectionAction(frame, 'release', selectionToken);
    }
    const template = buildNativeTextContextMenuTemplate(params, {
      platform: process.platform,
      hasValidFrame: Boolean(frame),
      semanticDescriptor,
      onLookUp: lookUpCommand?.request
    });
    const window = BrowserWindow.fromWebContents(webContents);
    if (!template || !window || window.isDestroyed()) {
      lookUpCommand?.cancel();
      return;
    }
    event.preventDefault?.();
    const popupOptions = {
      window,
      x: Number.isFinite(params.x) ? params.x : undefined,
      y: Number.isFinite(params.y) ? params.y : undefined
    };
    if (frame) popupOptions.frame = frame;
    if (lookUpCommand) {
      // AppKit finishes native menu tracking only after the popup closes.
      // Defer the dictionary request to the following main-loop turn so the
      // originating WebContents selection is still authoritative and the
      // Chromium NSView is no longer marked as showing a context menu.
      popupOptions.callback = () => lookUpCommand.afterPopupClosed();
    }
    if (process.platform !== 'darwin' && typeof params.menuSourceType === 'string') {
      popupOptions.sourceType = params.menuSourceType;
    }
    try {
      Menu.buildFromTemplate(template).popup(popupOptions);
    } catch {
      lookUpCommand?.cancel();
      if (textContextMenuLookUpCommands.get(webContents) === lookUpCommand) {
        textContextMenuLookUpCommands.delete(webContents);
      }
      if (!frame || window.isDestroyed()) return;
      const fallbackTemplate = buildNativeTextContextMenuTemplate(params, {
        platform: process.platform,
        hasValidFrame: false,
        semanticDescriptor
      });
      if (!fallbackTemplate) return;
      try {
        Menu.buildFromTemplate(fallbackTemplate).popup({
          window,
          x: popupOptions.x,
          y: popupOptions.y
        });
      } catch {
        // The window or frame was destroyed while native menu tracking began.
      }
    }
  });
}

app.setName(APP_NAME);
app.on('web-contents-created', (_event, webContents) => {
  installNativeTextContextMenu(webContents);
});
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();

function focusRuntime(runtime) {
  const window = runtime?.window;
  if (!window || window.isDestroyed()) return false;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  lastFocusedVaultId = runtime.vaultInfo.vaultId;
  return true;
}

function focusLastViewerWindow() {
  if (focusRuntime(vaultRuntimes.get(lastFocusedVaultId))) return;
  focusRuntime([...vaultRuntimes.values()].at(-1));
}

if (hasInstanceLock) {
  app.on('second-instance', focusLastViewerWindow);
}

function mutateDesktopSettings(transform) {
  const operation = desktopSettingsMutationQueue
    .catch(() => {})
    .then(async () => settingsStore.save(transform(await settingsStore.load())));
  desktopSettingsMutationQueue = operation.catch(() => {});
  return operation;
}

function mutateVaultRegistry(operation) {
  const queued = registryMutationQueue.catch(() => {}).then(operation);
  registryMutationQueue = queued.catch(() => {});
  return queued;
}

function runVaultLifecycleOperation(operation) {
  if (quitFlushPending) {
    return Promise.resolve({ ok: false, error: 'Viewer is closing.' });
  }
  const pending = Promise.resolve().then(operation);
  vaultLifecycleOperations.add(pending);
  const release = () => vaultLifecycleOperations.delete(pending);
  pending.then(release, release);
  return pending;
}

function serializeVaultLifecycle(vaultId, operation) {
  const previous = vaultLifecycleQueues.get(vaultId) || Promise.resolve();
  const queued = previous.catch(() => {}).then(operation);
  vaultLifecycleQueues.set(vaultId, queued);
  const release = () => {
    if (vaultLifecycleQueues.get(vaultId) === queued) vaultLifecycleQueues.delete(vaultId);
  };
  queued.then(release, release);
  return queued;
}

function runVaultOperation(runtime, operation) {
  if (runtime.vaultOperationsQuiescing) {
    return Promise.reject(new Error('This Vault is changing and cannot accept new work.'));
  }
  const pending = Promise.resolve().then(operation);
  runtime.vaultOperations.add(pending);
  const release = () => runtime.vaultOperations.delete(pending);
  pending.then(release, release);
  return pending;
}

async function quiesceVaultOperations(runtime) {
  runtime.vaultOperationsQuiescing = true;
  while (runtime.vaultOperations.size) {
    await Promise.allSettled([...runtime.vaultOperations]);
  }
}

async function settleVaultRuntimeOperations(runtimes, operation) {
  const results = await Promise.allSettled(runtimes.map(operation));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
}

function saveVaultFolderSettings(vaultId, nextSettings) {
  const nextRoots = folderRootsForVault(nextSettings, vaultId);
  return mutateDesktopSettings((settings) => (
    withFolderRootsForVault(settings, vaultId, nextRoots)
  ));
}

function runtimeForEvent(event) {
  const runtime = runtimeByWebContentsId.get(event?.sender?.id);
  if (!runtime) throw new Error('This Viewer window has no Vault context.');
  return runtime;
}

function registerVaultIpcHandler(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    const runtime = runtimeForEvent(event);
    return runVaultOperation(runtime, () => handler(runtime, event, ...args));
  });
}

async function vaultDiscoveryPayload(runtime) {
  const listed = await listRegisteredVaults(app.getPath('userData'));
  return {
    ok: true,
    currentVaultId: runtime.vaultInfo.vaultId,
    vaults: listed.vaults.map((vault) => ({
      ...vault,
      current: vault.vaultId === runtime.vaultInfo.vaultId,
      open: vaultRuntimes.has(vault.vaultId)
    })),
    projectName: runtime.vaultInfo.projectName,
    vaultName: runtime.vaultInfo.displayName
  };
}

async function switchVaultRuntime(sourceRuntime, vaultId) {
  try {
    const focused = vaultRuntimes.has(vaultId) || openingVaults.has(vaultId);
    const runtime = await openVaultWindow(vaultId, { rememberSelection: true });
    return {
      ok: true,
      opened: true,
      focused,
      currentVaultId: runtime.vaultInfo.vaultId
    };
  } catch (error) {
    console.error('[desktop:switch-vault]', error);
    return { ok: false, error: error.message || 'The selected Vault could not be opened.' };
  }
}

async function flushRendererWorkspaceState(targetWindow, { holdInteraction = false } = {}) {
  if (!targetWindow || targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
    return { ok: true };
  }
  const retainInert = holdInteraction ? 'true' : 'false';
  const result = await targetWindow.webContents.executeJavaScript(
    `(async () => {
      const root = document.documentElement;
      const lockKey = '__cneWorkspaceFlushInteractionLocks';
      globalThis[lockKey] = Math.max(0, Number(globalThis[lockKey]) || 0) + 1;
      const releaseInteraction = () => {
        globalThis[lockKey] = Math.max(0, (Number(globalThis[lockKey]) || 1) - 1);
        if (root) root.inert = globalThis[lockKey] > 0;
      };
      document.activeElement?.blur?.();
      if (root) root.inert = true;
      try {
        const flushResult = globalThis.flushWorkspaceStateNow
          ? await globalThis.flushWorkspaceStateNow()
          : { ok: true };
        if (!${retainInert} || flushResult?.ok === false) {
          releaseInteraction();
        }
        return flushResult;
      } catch (error) {
        releaseInteraction();
        throw error;
      }
    })()`
  );
  if (result?.ok === false) {
    const error = new Error(result.error || 'Pending changes could not be saved.');
    error.code = 'WORKSPACE_FLUSH_FAILED';
    throw error;
  }
  return result || { ok: true };
}

function reportWindowFlushFailure(targetWindow, error) {
  console.error('[desktop:flush-workspace-state]', error);
  if (!targetWindow || targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) return;
  const message = JSON.stringify(
    error?.message || 'Pending changes could not be saved. Close was cancelled.'
  );
  targetWindow.webContents.executeJavaScript(
    `globalThis.__cneWorkspaceFlushInteractionLocks = 0;
      document.documentElement.inert = false;
      typeof showStatus === 'function' && showStatus(${message}, true, 5000)`
  ).catch(() => {});
}

async function resolveStartupVault() {
  const legacySettings = await settingsStore.loadLegacyRaw();
  const legacyRoot = process.env.VIEWER_LEGACY_ROOT
    || legacySettings?.lastVaultPath
    || app.getAppPath();
  return ensureCurrentVault({
    appDataRoot: app.getPath('userData'),
    legacyRoot
  });
}

async function startViewerServer(runtime) {
  const serverContext = createVaultServerContext({
    appRoot: app.getAppPath(),
    vaultId: runtime.vaultInfo.vaultId,
    vaultRoot: runtime.vaultInfo.vaultRoot,
    resourceResolver: (location, context) => resolveDesktopResourceLocation(runtime, location, context),
    displayProxyService: runtime.displayProxyService,
    desktopMutationToken: runtime.desktopMutationToken
  });
  runtime.serverContext = serverContext;
  try {
    const server = await serverContext.start({ port: 0, host: '127.0.0.1' });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Viewer server did not provide a local TCP address.');
    }
    runtime.viewerOrigin = `http://127.0.0.1:${address.port}`;
  } catch (error) {
    await closeRuntimeServer(runtime);
    throw error;
  }
}

async function loadDesktopResource(runtime, pageId, resourceId) {
  if (!/^[a-z0-9_-]+$/i.test(pageId || '') || !/^[a-z0-9_-]+$/i.test(resourceId || '')) return null;
  const dataRoot = runtime.vaultInfo.vaultRoot;
  const pagesRoot = path.join(dataRoot, 'pages');
  const pageIndex = JSON.parse(await fs.readFile(path.join(dataRoot, 'pageIndex.json'), 'utf8'));
  const entry = (pageIndex.pages || []).find((page) => page.id === pageId);
  if (!entry || typeof entry.path !== 'string') return null;
  const pagePath = path.resolve(dataRoot, entry.path);
  if (!pagePath.startsWith(`${pagesRoot}${path.sep}`)) return null;
  const page = JSON.parse(await fs.readFile(pagePath, 'utf8'));
  return [...(page.objects || []), ...(page.maintenanceResources || [])]
    .find((resource) => resource.id === resourceId) || null;
}

async function loadDesktopImageResource(runtime, pageId, objectId) {
  const resource = await loadDesktopResource(runtime, pageId, objectId);
  return resource?.type === 'image' ? resource : null;
}

function parseSipsDimensions(stdout) {
  const width = Number(String(stdout).match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(String(stdout).match(/pixelHeight:\s*(\d+)/)?.[1]);
  return width > 0 && height > 0 ? { width, height } : null;
}

async function probeDesktopImage(filePath) {
  if (process.platform === 'darwin') {
    const { stdout } = await execFileAsync('/usr/bin/sips', [
      '-g', 'pixelWidth', '-g', 'pixelHeight', filePath
    ]);
    return parseSipsDimensions(stdout);
  }
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) return null;
  return image.getSize();
}

async function generateDesktopDisplayProxy({ sourcePath, destinationPath, maxLongEdge }) {
  if (process.platform === 'darwin') {
    await execFileAsync('/usr/bin/sips', [
      '-Z', String(maxLongEdge),
      '--setProperty', 'format', 'png',
      sourcePath,
      '--out', destinationPath
    ]);
    const dimensions = await probeDesktopImage(destinationPath);
    if (!dimensions) throw new Error('Generated display proxy could not be decoded.');
    return dimensions;
  }
  await new Promise((resolve) => setImmediate(resolve));
  const source = nativeImage.createFromPath(sourcePath);
  if (source.isEmpty()) throw new Error('Original image could not be decoded.');
  const size = source.getSize();
  const ratio = Math.min(1, maxLongEdge / Math.max(size.width, size.height));
  const dimensions = {
    width: Math.max(1, Math.round(size.width * ratio)),
    height: Math.max(1, Math.round(size.height * ratio))
  };
  const resized = source.resize({ ...dimensions, quality: 'best' });
  await fs.writeFile(destinationPath, resized.toPNG());
  return dimensions;
}

function createDesktopDisplayProxyService(runtime) {
  return createDisplayProxyService({
    vaultId: runtime.vaultInfo.projectId,
    cacheRoot: path.join(app.getPath('userData'), 'display-proxies', runtime.vaultInfo.projectId),
    loadResource: (pageId, objectId) => loadDesktopImageResource(runtime, pageId, objectId),
    resolveLocation: (location, context) => resolveDesktopResourceLocation(runtime, location, context),
    probeImage: probeDesktopImage,
    generateProxy: generateDesktopDisplayProxy
  });
}

function displayProxyPayload(runtime, value) {
  if (!value) return null;
  const variant = value.variant ? {
    tier: value.variant.tier,
    width: value.variant.width,
    height: value.variant.height,
    size: value.variant.size,
    displayUrl: `${runtime.viewerOrigin}${value.variant.displayPath}`
  } : null;
  return { ...value, variant };
}

function warmImportedDisplayProxies(runtime, pageId, linked) {
  if (!runtime.displayProxyService) return;
  for (const result of linked || []) {
    const object = result?.item;
    if (!object || object.type !== 'image' || object.displayable === false) continue;
    runtime.displayProxyService.requestVariant({
      pageId,
      objectId: object.id,
      requiredLongEdge: 2048
    }).catch((error) => console.warn('[desktop:display-proxy:warmup]', error.message));
  }
}

async function resolveDesktopResourceLocationDirect(runtime, location) {
  const settings = await settingsStore.load();
  return resolveResourceLocation(runtime.vaultInfo.vaultRoot, location, {
    workspaceDefinitions: runtime.workspaceDefinitions,
    workspaceRoots: workspaceRootsForVault(settings, runtime.vaultInfo.projectId),
    folderRegistry: runtime.folderRegistry,
    folderRoots: folderRootsForVault(settings, runtime.vaultInfo.projectId)
  });
}

async function managedRootForLocation(runtime, locationInput) {
  const location = normalizeResourceLocationInput(locationInput);
  const settings = await settingsStore.load();
  if (location.type === 'folder') {
    const rootPath = folderRootsForVault(settings, runtime.vaultInfo.projectId)[location.folderId];
    if (!rootPath || !runtime.folderRegistry?.folders?.some((folder) => folder.id === location.folderId)) return null;
    return {
      rootPath,
      toLocation: (relativePath) => ({ type: 'folder', folderId: location.folderId, relativePath })
    };
  }
  if (location.type === 'workspace') {
    const rootPath = workspaceRootsForVault(settings, runtime.vaultInfo.projectId)[location.workspaceId];
    if (!rootPath || !runtime.workspaceDefinitions?.workspaces?.[location.workspaceId]) return null;
    return {
      rootPath,
      toLocation: (relativePath) => ({ type: 'workspace', workspaceId: location.workspaceId, relativePath })
    };
  }
  if (location.type === 'vault') {
    const [assets, owner] = location.relativePath.split('/');
    if (assets !== 'assets' || !['images', 'resources'].includes(owner)) return null;
    return {
      rootPath: path.join(runtime.vaultInfo.vaultRoot, assets, owner),
      toLocation: (relativePath) => ({
        type: 'vault',
        relativePath: `${assets}/${owner}/${relativePath}`
      })
    };
  }
  return null;
}

async function persistManagedResourceRelocation(runtime, payload) {
  const response = await fetch(
    `${runtime.viewerOrigin}/api/pages/${encodeURIComponent(payload.pageId)}`
      + `/resources/${encodeURIComponent(payload.resourceId)}/location`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Viewer-Desktop-Token': runtime.desktopMutationToken
      },
      body: JSON.stringify({
        previousLocation: payload.previousLocation,
        nextLocation: payload.nextLocation
      })
    }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || 'The relocated resource reference could not be saved.');
    error.code = body.code || 'RELOCATION_PERSIST_FAILED';
    throw error;
  }
  return body;
}

async function resolveDesktopResourceLocation(runtime, location, context = {}) {
  if (!runtime.managedResourceRelocator) return resolveDesktopResourceLocationDirect(runtime, location);
  return runtime.managedResourceRelocator.resolve(location, context);
}

async function resolveDesktopResourceRequest(runtime, request) {
  const structured = request && typeof request === 'object' && request.location
    ? request
    : { location: request };
  const pageId = structured.pageId;
  const resourceId = structured.resourceId;
  const resource = await loadDesktopResource(runtime, pageId, resourceId).catch(() => null);
  if ((pageId || resourceId) && !resource) {
    const error = new Error('Resource not found.');
    error.code = 'RESOURCE_NOT_FOUND';
    throw error;
  }
  const location = resource ? normalizeResourceLocationInput(resource) : structured.location;
  return resolveDesktopResourceLocation(runtime, location, { pageId, resourceId, resource });
}

async function showOpenDialog(runtime, options) {
  return runtime?.window && !runtime.window.isDestroyed()
    ? dialog.showOpenDialog(runtime.window, options)
    : dialog.showOpenDialog(options);
}

async function showMessageBox(runtime, options) {
  return runtime?.window && !runtime.window.isDestroyed()
    ? dialog.showMessageBox(runtime.window, options)
    : dialog.showMessageBox(options);
}

async function createAddFileWorkflow(runtime) {
  return createFolderFileService({
    vaultId: runtime.vaultInfo.projectId,
    vaultRoot: runtime.vaultInfo.vaultRoot,
    loadRegistry: async () => runtime.folderRegistry,
    loadSettings: () => settingsStore.load(),
    selectFiles: async () => {
      const selection = await showOpenDialog(runtime, {
        title: 'Add File',
        message: 'Files in registered folders are linked; other files use this Vault’s managed folders.',
        properties: ['openFile', 'multiSelections']
      });
      return selection.canceled ? null : selection.filePaths;
    },
    readImageSize: async (filePath) => {
      const image = nativeImage.createFromPath(filePath);
      if (image.isEmpty()) return null;
      const size = image.getSize();
      return size.width > 0 && size.height > 0 ? size : null;
    }
  });
}

function logAddFileStage(stage, details = {}) {
  console.info(`[desktop:add-file:${stage}]`, details);
}

async function requestAddFileMutation(runtime, pageId, files, placementCenter = null, stageOnly = false) {
  const response = await fetch(
    `${runtime.viewerOrigin}/api/pages/${encodeURIComponent(pageId)}/add-files`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Viewer-Desktop-Token': runtime.desktopMutationToken
      },
      body: JSON.stringify({ files, placementCenter, stageOnly })
    }
  );
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
  }
  return { ok: response.ok, status: response.status, body };
}

async function addFilesToPage(runtime, pageId, {
  selectedPaths,
  source = 'picker',
  placementCenter = null,
  stageOnly = false
} = {}) {
  const workflow = await createAddFileWorkflow(runtime);
  const result = await executeAddFiles({
    pageId,
    source,
    selectedPaths,
    prepareFiles: ({ selectedPaths: preparedPaths }) => workflow.prepareFiles({ selectedPaths: preparedPaths }),
    requestMutation: (files) => requestAddFileMutation(runtime, pageId, files, placementCenter, stageOnly),
    log: logAddFileStage
  });
  if (result?.ok) warmImportedDisplayProxies(runtime, pageId, result.linked);
  return result;
}

function createResourceFolderManager(runtime) {
  return createFolderService({
    vaultId: runtime.vaultInfo.projectId,
    loadRegistry: async () => runtime.folderRegistry,
    saveRegistry: async (next) => {
      runtime.folderRegistry = await writeFolderRegistry(runtime.vaultInfo.vaultRoot, next);
      return runtime.folderRegistry;
    },
    loadSettings: () => settingsStore.load(),
    saveSettings: (next) => saveVaultFolderSettings(runtime.vaultInfo.projectId, next),
    selectFolder: async () => {
      const selection = await showOpenDialog(runtime, {
        title: 'Select Resource Folder',
        properties: ['openDirectory', 'createDirectory']
      });
      return selection.canceled ? null : selection.filePaths[0];
    }
  });
}

function createResourceFolderMaintenanceManager(runtime) {
  return createFolderMaintenanceService({
    vaultId: runtime.vaultInfo.projectId,
    vaultRoot: runtime.vaultInfo.vaultRoot,
    loadRegistry: async () => runtime.folderRegistry,
    saveRegistry: async (next) => {
      runtime.folderRegistry = await writeFolderRegistry(runtime.vaultInfo.vaultRoot, next);
      return runtime.folderRegistry;
    },
    loadSettings: () => settingsStore.load(),
    saveSettings: (next) => saveVaultFolderSettings(runtime.vaultInfo.projectId, next),
    selectFolder: async () => {
      const selection = await showOpenDialog(runtime, {
        title: 'Change Resource Folder',
        properties: ['openDirectory', 'createDirectory']
      });
      return selection.canceled ? null : selection.filePaths[0];
    },
    confirmChange: async ({ message, detail }) => {
      const result = await showMessageBox(runtime, {
        type: 'warning',
        title: 'Change linked folder?',
        message,
        detail,
        buttons: ['Cancel', 'Change anyway'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      return result.response === 1;
    },
    confirmMigration: async ({ message, detail }) => {
      const result = await showMessageBox(runtime, {
        type: 'warning',
        title: 'Remove folder link?',
        message,
        detail,
        buttons: ['Cancel', 'Copy referenced files to default'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      return result.response === 1;
    }
  });
}

function secureWebPreferences() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true
  };
}

function allowViewerNavigation(runtime, url) {
  try {
    return new URL(url).origin === runtime.viewerOrigin;
  } catch {
    return false;
  }
}

function childWindowWidth(url) {
  try {
    return new URL(url).pathname === '/vocabulary.html'
      ? VOCABULARY_DEFAULT_WINDOW_WIDTH
      : DEFAULT_CHILD_WINDOW_WIDTH;
  } catch {
    return DEFAULT_CHILD_WINDOW_WIDTH;
  }
}

function configureWindowSecurity(runtime, window) {
  window.webContents.on('will-navigate', (event, url) => {
    if (!allowViewerNavigation(runtime, url)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!allowViewerNavigation(runtime, url)) return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: childWindowWidth(url),
        height: 760,
        parent: window,
        webPreferences: secureWebPreferences()
      }
    };
  });
}

async function closeRuntimeServer(runtime, { propagateError = false } = {}) {
  const vaultId = runtime?.vaultInfo?.vaultId;
  const serverContext = runtime?.serverContext;
  if (!serverContext) {
    if (vaultId && closingVaultServers.has(vaultId)) {
      try {
        await closingVaultServers.get(vaultId);
      } catch (error) {
        if (propagateError) throw error;
      }
    }
    return;
  }
  runtime.serverContext = null;
  const previousClose = closingVaultServers.get(vaultId) || Promise.resolve();
  const closePromise = previousClose.catch(() => {}).then(async () => {
    try {
      await serverContext.close();
    } catch (error) {
      console.error(`[desktop:server-close:${vaultId}]`, error);
      if (propagateError) throw error;
    }
  });
  closingVaultServers.set(vaultId, closePromise);
  const clearCloseRecord = () => {
    if (closingVaultServers.get(vaultId) === closePromise) {
      closingVaultServers.delete(vaultId);
    }
  };
  closePromise.then(clearCloseRecord, clearCloseRecord);
  await closePromise;
}

async function createRuntimeWindow(runtime) {
  const window = new BrowserWindow({
    title: APP_NAME,
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 10 }
    } : {}),
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 620,
    show: false,
    webPreferences: secureWebPreferences()
  });
  runtime.window = window;
  const webContentsId = window.webContents.id;
  runtimeByWebContentsId.set(webContentsId, runtime);
  configureWindowSecurity(runtime, window);
  window.on('focus', () => {
    lastFocusedVaultId = runtime.vaultInfo.vaultId;
  });
  window.on('close', (event) => {
    if (quittingForServerClose || runtime.windowCloseAuthorized) return;
    event.preventDefault();
    if (runtime.vaultMutationInProgress) return;
    if (runtime.windowCloseOperation) return;
    const closeOperation = runVaultLifecycleOperation(() => serializeVaultLifecycle(
      runtime.vaultInfo.vaultId,
      async () => {
        await flushRendererWorkspaceState(window, { holdInteraction: true });
        await quiesceVaultOperations(runtime);
        runtime.windowCloseAuthorized = true;
        if (!window.isDestroyed()) window.close();
        await closeRuntimeServer(runtime);
      }
    ));
    runtime.windowCloseOperation = closeOperation;
    closeOperation.catch((error) => {
      reportWindowFlushFailure(window, error);
    }).finally(() => {
      if (runtime.windowCloseOperation === closeOperation) {
        runtime.windowCloseOperation = null;
      }
    });
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    runtimeByWebContentsId.delete(webContentsId);
    if (vaultRuntimes.get(runtime.vaultInfo.vaultId) === runtime) {
      vaultRuntimes.delete(runtime.vaultInfo.vaultId);
    }
    if (lastFocusedVaultId === runtime.vaultInfo.vaultId) {
      lastFocusedVaultId = [...vaultRuntimes.keys()].at(-1) || null;
    }
    runtime.window = null;
    closeRuntimeServer(runtime).catch(logDesktopError('close-vault-server'));
  });
  await window.loadURL(runtime.viewerOrigin);
  return window;
}

function vaultInfoFromEntry(entry) {
  return {
    id: entry.vaultId,
    vaultId: entry.vaultId,
    displayName: entry.displayName,
    projectId: entry.vaultId,
    projectName: entry.displayName,
    root: path.resolve(entry.vaultRoot),
    vaultRoot: path.resolve(entry.vaultRoot)
  };
}

async function configureRuntimeVaultServices(runtime) {
  runtime.workspaceDefinitions = await readWorkspaceDefinitions(runtime.vaultInfo.vaultRoot);
  runtime.folderRegistry = await readFolderRegistry(runtime.vaultInfo.vaultRoot);
  runtime.desktopMutationToken = crypto.randomUUID();
  runtime.managedResourceRelocator = createManagedResourceRelocator({
    resolveDirect: (location) => resolveDesktopResourceLocationDirect(runtime, location),
    managedRoot: (location) => managedRootForLocation(runtime, location),
    persistRelocation: (payload) => persistManagedResourceRelocation(runtime, payload)
  });
  runtime.displayProxyService = createDesktopDisplayProxyService(runtime);
}

async function openVaultWindow(vaultId, { rememberSelection = false } = {}) {
  if (openingVaults.has(vaultId)) return openingVaults.get(vaultId);

  const opening = serializeVaultLifecycle(vaultId, async () => {
    const existing = vaultRuntimes.get(vaultId);
    if (existing) {
      if (rememberSelection) {
        await mutateVaultRegistry(() => selectRegisteredVault(app.getPath('userData'), vaultId));
      }
      focusRuntime(existing);
      return existing;
    }
    if (closingVaultServers.has(vaultId)) {
      await closingVaultServers.get(vaultId);
    }
    const { entry } = await validateRegisteredVault(app.getPath('userData'), vaultId);
    const runtime = {
      vaultInfo: vaultInfoFromEntry(entry),
      serverContext: null,
      viewerOrigin: null,
      window: null,
      workspaceDefinitions: null,
      folderRegistry: null,
      desktopMutationToken: null,
      managedResourceRelocator: null,
      displayProxyService: null,
      vaultMutationInProgress: false,
      vaultOperations: new Set(),
      vaultOperationsQuiescing: false,
      windowCloseAuthorized: false,
      windowCloseOperation: null
    };
    try {
      await configureRuntimeVaultServices(runtime);
      await startViewerServer(runtime);
      vaultRuntimes.set(vaultId, runtime);
      await createRuntimeWindow(runtime);
      if (rememberSelection) {
        await mutateVaultRegistry(() => selectRegisteredVault(app.getPath('userData'), vaultId));
      }
      focusRuntime(runtime);
      return runtime;
    } catch (error) {
      vaultRuntimes.delete(vaultId);
      if (runtime.window && !runtime.window.isDestroyed()) runtime.window.destroy();
      await closeRuntimeServer(runtime);
      throw error;
    }
  });
  openingVaults.set(vaultId, opening);
  try {
    return await opening;
  } finally {
    openingVaults.delete(vaultId);
  }
}

async function rebindRuntimeAfterRename(runtime, entry, { serverAlreadyClosed = false } = {}) {
  if (!serverAlreadyClosed) {
    await closeRuntimeServer(runtime, { propagateError: true });
  }
  runtime.vaultInfo = vaultInfoFromEntry(entry);
  try {
    await configureRuntimeVaultServices(runtime);
    await startViewerServer(runtime);
  } catch (error) {
    await closeRuntimeServer(runtime);
    throw error;
  }
}

async function reloadRuntimeAfterRename(runtime) {
  const window = runtime.window;
  if (!window || window.isDestroyed()) return;
  await window.loadURL(runtime.viewerOrigin);
  focusRuntime(runtime);
}

function installApplicationMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: APP_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function logDesktopError(operation) {
  return (error) => {
    console.error(`[desktop:${operation}]`, error);
  };
}

async function runFolderIpcAction(runtime, operation, action) {
  try {
    const result = await action();
    if (!result?.ok) return result;
    return { ...result, registry: await createResourceFolderManager(runtime).state() };
  } catch (error) {
    console.error(`[desktop:resource-folder:${operation}]`, error);
    return {
      ok: false,
      error: error instanceof FolderMaintenanceError
        ? error.message
        : 'The folder setting could not be saved.'
    };
  }
}

function registerIpcHandlers() {
  function resourceActionsFor(runtime) {
    if (runtime.resourceActions) return runtime.resourceActions;
    runtime.resourceActions = createResourceActions({
    getVaultRoot: () => runtime.vaultInfo.vaultRoot,
    resolveResourcePath: (_vaultRoot, request) => resolveDesktopResourceRequest(runtime, request),
    openPath: async (absolutePath) => {
      const errorMessage = await shell.openPath(absolutePath);
      if (errorMessage) throw new Error(errorMessage);
    },
    revealPath: async (absolutePath) => shell.showItemInFolder(absolutePath),
    logger: console
    });
    return runtime.resourceActions;
  }
  function externalLinkActionsFor(runtime) {
    if (runtime.externalLinkActions) return runtime.externalLinkActions;
    runtime.externalLinkActions = createExternalLinkActions({
    vaultId: runtime.vaultInfo.projectId,
    loadSettings: () => settingsStore.load(),
    storeExternalTarget: (externalFileId, absolutePath) => mutateDesktopSettings((settings) => (
      setExternalFileTarget(settings, runtime.vaultInfo.projectId, externalFileId, absolutePath)
    )),
    selectFile: async () => {
      const selection = await showOpenDialog(runtime, {
        title: 'Select External Link File',
        properties: ['openFile']
      });
      return selection.canceled ? null : selection.filePaths[0];
    },
    resolveFileRef: (location, context) => resolveDesktopResourceLocation(runtime, location, context),
    openPath: (absolutePath) => shell.openPath(absolutePath),
    openExternal: (url) => shell.openExternal(url),
    logger: console
    });
    return runtime.externalLinkActions;
  }

  registerVaultIpcHandler(IPC.GET_VAULT_INFO, (runtime) => vaultDiscoveryPayload(runtime));
  ipcMain.handle(IPC.WRITE_CLIPBOARD_TEXT, (_event, text) => {
    clipboard.writeText(typeof text === 'string' ? text : String(text || ''));
    return { ok: true };
  });
  ipcMain.handle(IPC.SWITCH_VAULT, (event, vaultId) => (
    runVaultLifecycleOperation(() => switchVaultRuntime(runtimeForEvent(event), vaultId))
  ));
  ipcMain.handle(IPC.CREATE_VAULT, (event, name) => runVaultLifecycleOperation(async () => {
    const sourceRuntime = runtimeForEvent(event);
    if (sourceRuntime.vaultMutationInProgress) {
      return { ok: false, error: 'A Vault change is already in progress.' };
    }
    sourceRuntime.vaultMutationInProgress = true;
    try {
      const created = await mutateVaultRegistry(() => (
        createRegisteredVault(app.getPath('userData'), name)
      ));
      const opened = await openVaultWindow(created.entry.vaultId, { rememberSelection: true });
      return {
        ok: true,
        restarting: false,
        opened: true,
        vaultId: created.entry.vaultId,
        currentVaultId: opened.vaultInfo.vaultId
      };
    } catch (error) {
      console.error('[desktop:create-vault]', error);
      return { ok: false, error: error.message || 'The new Vault could not be created.' };
    } finally {
      sourceRuntime.vaultMutationInProgress = false;
    }
  }));
  ipcMain.handle(IPC.RENAME_VAULT, (event, vaultId, name) => {
    const sourceRuntime = runtimeForEvent(event);
    return runVaultLifecycleOperation(() => serializeVaultLifecycle(vaultId, async () => {
      const targetRuntime = vaultRuntimes.get(vaultId) || null;
      const mutationOwner = targetRuntime || sourceRuntime;
      let previousEntry = null;
      let targetRuntimeQuiesced = false;
      let preserveRuntimeQuiescence = false;
      if (mutationOwner.vaultMutationInProgress) {
        return { ok: false, error: 'A Vault change is already in progress.' };
      }
      mutationOwner.vaultMutationInProgress = true;
      try {
        const renamed = await mutateVaultRegistry(() => (
          renameRegisteredVault(app.getPath('userData'), vaultId, name, {
            beforeMutation: async ({ entry }) => {
              if (!targetRuntime) return;
              previousEntry = entry;
              if (targetRuntime.window) {
                await flushRendererWorkspaceState(targetRuntime.window, { holdInteraction: true });
              }
              await quiesceVaultOperations(targetRuntime);
              preserveRuntimeQuiescence = true;
              targetRuntimeQuiesced = true;
              await closeRuntimeServer(targetRuntime, { propagateError: true });
            },
            afterMutation: async ({ entry }) => {
              if (!targetRuntime) return;
              await rebindRuntimeAfterRename(targetRuntime, entry, { serverAlreadyClosed: true });
            }
          })
        ));
        if (targetRuntime && targetRuntimeQuiesced) {
          preserveRuntimeQuiescence = false;
          targetRuntime.vaultOperationsQuiescing = false;
          try {
            await reloadRuntimeAfterRename(targetRuntime);
          } catch (reloadError) {
            console.error('[desktop:rename-vault-reload]', reloadError);
            reportWindowFlushFailure(targetRuntime.window, reloadError);
          }
        }
        return {
          ok: true,
          restarting: false,
          vaultId: renamed.entry.vaultId,
          displayName: renamed.entry.displayName
        };
      } catch (error) {
        console.error('[desktop:rename-vault]', error);
        if (targetRuntime && targetRuntimeQuiesced && previousEntry) {
          try {
            await rebindRuntimeAfterRename(targetRuntime, previousEntry, {
              serverAlreadyClosed: true
            });
            preserveRuntimeQuiescence = false;
            targetRuntime.vaultOperationsQuiescing = false;
            try {
              await reloadRuntimeAfterRename(targetRuntime);
            } catch (reloadError) {
              console.error('[desktop:rename-vault-recovery-reload]', reloadError);
              reportWindowFlushFailure(targetRuntime.window, reloadError);
            }
          } catch (recoveryError) {
            console.error('[desktop:rename-vault-recovery]', recoveryError);
            reportWindowFlushFailure(targetRuntime.window, recoveryError);
          }
        }
        return { ok: false, error: error.message || 'The Vault could not be renamed.' };
      } finally {
        mutationOwner.vaultMutationInProgress = false;
        if (targetRuntime && !preserveRuntimeQuiescence) {
          targetRuntime.vaultOperationsQuiescing = false;
        }
      }
    }));
  });
  ipcMain.handle(IPC.SHOW_CONTEXT_MENU, (event, context) => new Promise((resolve) => {
    let settled = false;
    const finish = (commandId = null) => {
      if (settled) return;
      settled = true;
      resolve(commandId ? { commandId } : null);
    };
    const template = buildNativeContextMenuTemplate(context, finish);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!template || !window || window.isDestroyed()) return finish();
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window, callback: () => finish() });
  }));
  registerVaultIpcHandler(IPC.RESOLVE_MANAGED_RESOURCE, async (runtime, _event, request) => {
    try {
      const resolved = await resolveDesktopResourceRequest(runtime, request);
      return {
        ok: true,
        location: resolved.location,
        relocated: resolved.relocated === true,
        previousLocation: resolved.previousLocation || null,
        updatedResourceIds: resolved.updatedResourceIds || []
      };
    } catch (error) {
      const code = error.code === 'NOT_FOUND' ? 'SOURCE_MISSING' : (error.code || 'RESOURCE_RESOLVE_FAILED');
      return {
        ok: false,
        code,
        error: ['SOURCE_MISSING', 'RESOURCE_NOT_FOUND'].includes(code)
          ? 'Original resource is unavailable.'
          : 'The managed resource could not be resolved.'
      };
    }
  });
  registerVaultIpcHandler(IPC.REQUEST_DISPLAY_PROXY, async (runtime, event, request) => {
    if (!runtime.displayProxyService) return { ok: false, error: 'Display proxies are unavailable.' };
    try {
      const response = await runtime.displayProxyService.requestVariant(request, (ready) => {
        if (event.sender.isDestroyed()) return;
        event.sender.send('cne-desktop:display-proxy-ready', displayProxyPayload(runtime, ready));
      });
      return displayProxyPayload(runtime, response);
    } catch (error) {
      const code = error.code || 'DISPLAY_PROXY_FAILED';
      const safeMessages = {
        INVALID_RESOURCE_ID: 'A valid page and image object are required.',
        RESOURCE_NOT_FOUND: 'Display image not found.',
        SOURCE_MISSING: 'Original image is unavailable.',
        INVALID_IMAGE: 'Original image dimensions could not be read.'
      };
      return {
        ok: false,
        code,
        error: safeMessages[code] || 'Display proxy could not be prepared.'
      };
    }
  });
  registerVaultIpcHandler(IPC.GET_CONTROL_SETTINGS, async (runtime) => {
    const settings = await settingsStore.load();
    return {
      zoomSensitivity: zoomSensitivityForVault(settings, runtime.vaultInfo.projectId)
    };
  });
  registerVaultIpcHandler(IPC.SET_ZOOM_SENSITIVITY, async (runtime, _event, value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)
      || value < MIN_ZOOM_SENSITIVITY || value > MAX_ZOOM_SENSITIVITY) {
      return { ok: false, error: 'Zoom sensitivity must be between 0.5 and 5.0.' };
    }
    try {
      const saved = await mutateDesktopSettings((settings) => withZoomSensitivityForVault(
        settings, runtime.vaultInfo.projectId, value
      ));
      return {
        ok: true,
        zoomSensitivity: zoomSensitivityForVault(saved, runtime.vaultInfo.projectId)
      };
    } catch (error) {
      console.error('[desktop:set-zoom-sensitivity]', error);
      return { ok: false, error: 'Zoom sensitivity could not be saved.' };
    }
  });
  registerVaultIpcHandler(IPC.GET_NAVIGATION_SORT_MODE, async (runtime) => {
    const result = await loadNavigationSortModeOwner({
      settingsStore,
      mutateSettings: mutateDesktopSettings,
      vaultId: runtime.vaultInfo.projectId,
      vaultRoot: runtime.vaultInfo.vaultRoot
    });
    return { sortMode: result.sortMode };
  });
  registerVaultIpcHandler(IPC.SET_NAVIGATION_SORT_MODE, async (runtime, _event, value) => {
    try {
      const saved = await mutateDesktopSettings((settings) => withNavigationSortMode(
        settings, runtime.vaultInfo.projectId, value
      ));
      return { ok: true, sortMode: navigationSortModeForVault(saved, runtime.vaultInfo.projectId) };
    } catch (error) {
      console.error('[desktop:set-navigation-sort-mode]', error);
      return { ok: false, error: 'Navigation sort order could not be saved.' };
    }
  });
  registerVaultIpcHandler(IPC.GET_WORKSPACE_STATE, async (runtime) => {
    const rawSettings = await settingsStore.loadLegacyRaw();
    const canonicalSortMode = explicitNavigationSortModeForVault(
      rawSettings,
      runtime.vaultInfo.projectId
    );
    const { state } = await migrateVaultWorkspaceStateNavigationSort(
      runtime.vaultInfo.vaultRoot,
      { removeLegacyOwner: Boolean(canonicalSortMode) }
    );
    return {
      ok: true,
      exists: Boolean(state.workspaceState),
      workspaceState: state.workspaceState
    };
  });
  registerVaultIpcHandler(IPC.SET_WORKSPACE_STATE, async (runtime, _event, value) => {
    try {
      const saved = await updateVaultWorkspaceState(runtime.vaultInfo.vaultRoot, (state) => ({
        ...state,
        workspaceState: value
      }));
      return {
        ok: true,
        exists: true,
        workspaceState: saved.workspaceState
      };
    } catch (error) {
      console.error('[desktop:set-workspace-state]', error);
      return { ok: false, error: 'Workspace state could not be saved.' };
    }
  });
  ipcMain.handle(IPC.LIST_SYSTEM_FONTS, async () => {
    try {
      return { ok: true, fontFamilies: await fontService.listFontFamilies() };
    } catch (error) {
      console.error('[desktop:list-system-fonts]', error);
      return { ok: false, error: 'Installed fonts could not be listed.', fontFamilies: [] };
    }
  });
  registerVaultIpcHandler(IPC.ADD_FILES, async (runtime, _event, pageId, options = {}) => {
    try {
      return await addFilesToPage(runtime, pageId, {
        placementCenter: options.placementCenter || null,
        stageOnly: options.stageOnly === true
      });
    } catch (error) {
      console.error('[desktop:add-files]', error);
      return { ok: false, error: error.message || 'The selected files could not be added.' };
    }
  });
  registerVaultIpcHandler(
    IPC.ADD_DROPPED_FILES,
    async (runtime, _event, pageId, selectedPaths, options = {}) => {
      try {
        if (!Array.isArray(selectedPaths) || !selectedPaths.length) {
          return { ok: false, error: 'No original files were dropped.' };
        }
        return await addFilesToPage(runtime, pageId, {
          selectedPaths,
          source: 'drop',
          placementCenter: options.placementCenter || null,
          stageOnly: options.stageOnly === true
        });
      } catch (error) {
        console.error('[desktop:add-dropped-files]', error);
        return { ok: false, error: 'The dropped files could not be added.' };
      }
    }
  );
  registerVaultIpcHandler(IPC.GET_RESOURCE_FOLDERS, async (runtime) => (
    createResourceFolderManager(runtime).state()
  ));
  registerVaultIpcHandler(IPC.SELECT_DEFAULT_FOLDER, async (runtime) => {
    return runFolderIpcAction(
      runtime, 'select-default', () => createResourceFolderManager(runtime).chooseDefaultFolder()
    );
  });
  registerVaultIpcHandler(IPC.ADD_READ_ONLY_FOLDER, async (runtime) => {
    return runFolderIpcAction(
      runtime, 'add-read-only', () => createResourceFolderManager(runtime).addReadOnlyFolder()
    );
  });
  registerVaultIpcHandler(IPC.CHANGE_READ_ONLY_FOLDER, async (runtime, _event, folderId) => {
    return runFolderIpcAction(
      runtime, 'change-read-only', () => (
        createResourceFolderMaintenanceManager(runtime).changeReadOnlyFolder(folderId)
      )
    );
  });
  registerVaultIpcHandler(IPC.REMOVE_READ_ONLY_FOLDER, async (runtime, _event, folderId) => {
    return runFolderIpcAction(
      runtime, 'remove-read-only', () => (
        createResourceFolderMaintenanceManager(runtime).removeReadOnlyFolder(folderId)
      )
    );
  });
  registerVaultIpcHandler(IPC.SET_DEFAULT_FOLDER, async (runtime, _event, folderId) => {
    return runFolderIpcAction(
      runtime, 'set-default', () => createResourceFolderManager(runtime).setDefaultFolder(folderId)
    );
  });
  registerVaultIpcHandler(IPC.RELINK_FOLDER, async (runtime, _event, folderId) => {
    return runFolderIpcAction(
      runtime, 'relink', () => createResourceFolderManager(runtime).relinkFolder(folderId)
    );
  });
  registerVaultIpcHandler(IPC.OPEN_RESOURCE, (runtime, _event, relativePath) => (
    resourceActionsFor(runtime).openVaultResource(relativePath)
  ));
  registerVaultIpcHandler(IPC.REVEAL_RESOURCE, (runtime, _event, relativePath) => (
    resourceActionsFor(runtime).revealVaultResource(relativePath)
  ));
  registerVaultIpcHandler(IPC.SELECT_EXTERNAL_LINK_FILE, (runtime) => (
    externalLinkActionsFor(runtime).selectExternalFile()
  ));
  registerVaultIpcHandler(
    IPC.REGISTER_DROPPED_EXTERNAL_LINK_FILE,
    (runtime, _event, selectedPaths) => (
      externalLinkActionsFor(runtime).registerDroppedExternalFile(selectedPaths)
    )
  );
  registerVaultIpcHandler(IPC.DESCRIBE_EXTERNAL_LINK_FILE, (runtime, _event, fileRef) => (
    externalLinkActionsFor(runtime).describeExternalFile(fileRef)
  ));
  registerVaultIpcHandler(IPC.OPEN_EXTERNAL_LINK_TARGET, (runtime, _event, target) => (
    externalLinkActionsFor(runtime).openExternalTarget(target)
  ));
}

async function bootstrapDesktop() {
  settingsStore = createDesktopSettings({ userDataDir: app.getPath('userData') });
  const startupVault = await resolveStartupVault();
  if (!startupVault) {
    app.quit();
    return;
  }
  const registry = await listRegisteredVaults(app.getPath('userData'));
  const settings = await settingsStore.loadLegacyRaw();
  await settingsStore.save(migrateLegacyZoomSensitivities(
    settings,
    registry.vaults.map((vault) => vault.vaultId)
  ));
  registerIpcHandlers();
  installApplicationMenu();
  await openVaultWindow(startupVault.vaultId);
}

app.on('before-quit', (event) => {
  if (quittingForServerClose) return;
  event.preventDefault();
  if (quitFlushPending) return;
  quitFlushPending = true;
  (async () => {
    await Promise.allSettled([...vaultLifecycleOperations]);
    await Promise.allSettled([...openingVaults.values()]);
    await registryMutationQueue.catch(() => {});
    const runtimes = [...vaultRuntimes.values()];
    await settleVaultRuntimeOperations(runtimes, async (runtime) => {
      await flushRendererWorkspaceState(runtime.window, { holdInteraction: true });
      await quiesceVaultOperations(runtime);
    });
    await settleVaultRuntimeOperations(
      runtimes,
      (runtime) => closeRuntimeServer(runtime)
    );
    quitFlushPending = false;
    quittingForServerClose = true;
    app.quit();
  })().catch((error) => {
    quitFlushPending = false;
    console.error('[desktop:shutdown]', error);
    for (const runtime of vaultRuntimes.values()) {
      runtime.vaultOperationsQuiescing = false;
      reportWindowFlushFailure(runtime.window, error);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (quitFlushPending) return;
  if (vaultRuntimes.size) return focusLastViewerWindow();
  listRegisteredVaults(app.getPath('userData'))
    .then((registry) => openVaultWindow(registry.currentVaultId))
    .catch(logDesktopError('create-window'));
});

if (hasInstanceLock) {
  app.whenReady().then(bootstrapDesktop).catch(async (error) => {
    console.error('[desktop:startup]', error);
    await dialog.showMessageBox({
      type: 'error',
      title: `${APP_NAME} could not start`,
      message: 'The Viewer could not start.',
      detail: 'Check that the selected vault is readable, then try again.'
    });
    app.quit();
  });
}
