const { contextBridge, ipcRenderer, webUtils } = require('electron');

function addDroppedFiles(pageId, files, options = {}) {
  try {
    const selectedPaths = Array.from(files || [], (file) => webUtils.getPathForFile(file))
      .filter(Boolean);
    if (!selectedPaths.length) {
      return Promise.resolve({ ok: false, error: 'No files were dropped.' });
    }
    return ipcRenderer.invoke('cne-desktop:add-dropped-files', pageId, selectedPaths, options);
  } catch {
    return Promise.resolve({ ok: false, error: 'The dropped files could not be read.' });
  }
}

function registerDroppedExternalLinkFile(files) {
  try {
    const selectedPaths = Array.from(files || [], (file) => webUtils.getPathForFile(file))
      .filter(Boolean);
    if (!selectedPaths.length) {
      return Promise.resolve({ ok: false, error: 'No local file was dropped.' });
    }
    return ipcRenderer.invoke('cne-desktop:register-dropped-external-link-file', selectedPaths);
  } catch {
    return Promise.resolve({ ok: false, error: 'The dropped file could not be read.' });
  }
}

contextBridge.exposeInMainWorld('cneDesktop', Object.freeze({
  isDesktop: true,
  writeClipboardText: (text) => ipcRenderer.invoke('cne-desktop:write-clipboard-text', text),
  showContextMenu: (context) => ipcRenderer.invoke('cne-desktop:show-context-menu', context),
  resolveManagedResource: (request) => (
    ipcRenderer.invoke('cne-desktop:resolve-managed-resource', request)
  ),
  requestDisplayProxy: (request) => ipcRenderer.invoke('cne-desktop:request-display-proxy', request),
  onDisplayProxyReady: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('cne-desktop:display-proxy-ready', wrapped);
    return () => ipcRenderer.removeListener('cne-desktop:display-proxy-ready', wrapped);
  },
  getVaultInfo: () => ipcRenderer.invoke('cne-desktop:get-vault-info'),
  createVault: (name) => ipcRenderer.invoke('cne-desktop:create-vault', name),
  renameVault: (vaultId, name) => ipcRenderer.invoke('cne-desktop:rename-vault', vaultId, name),
  switchVault: (vaultId) => ipcRenderer.invoke('cne-desktop:switch-vault', vaultId),
  getControlSettings: () => ipcRenderer.invoke('cne-desktop:get-control-settings'),
  setZoomSensitivity: (value) => ipcRenderer.invoke('cne-desktop:set-zoom-sensitivity', value),
  getNavigationSortMode: () => ipcRenderer.invoke('cne-desktop:get-navigation-sort-mode'),
  setNavigationSortMode: (value) => (
    ipcRenderer.invoke('cne-desktop:set-navigation-sort-mode', value)
  ),
  getWorkspaceState: () => ipcRenderer.invoke('cne-desktop:get-workspace-state'),
  setWorkspaceState: (value) => ipcRenderer.invoke('cne-desktop:set-workspace-state', value),
  listSystemFontFamilies: () => ipcRenderer.invoke('cne-desktop:list-system-fonts'),
  addDroppedFiles,
  addFiles: (pageId, options = {}) => ipcRenderer.invoke('cne-desktop:add-files', pageId, options),
  getResourceFolders: () => ipcRenderer.invoke('cne-desktop:get-resource-folders'),
  selectDefaultFolder: () => ipcRenderer.invoke('cne-desktop:select-default-folder'),
  addReadOnlyFolder: () => ipcRenderer.invoke('cne-desktop:add-read-only-folder'),
  changeReadOnlyFolder: (folderId) => (
    ipcRenderer.invoke('cne-desktop:change-read-only-folder', folderId)
  ),
  removeReadOnlyFolder: (folderId) => (
    ipcRenderer.invoke('cne-desktop:remove-read-only-folder', folderId)
  ),
  setDefaultFolder: (folderId) => ipcRenderer.invoke('cne-desktop:set-default-folder', folderId),
  relinkFolder: (folderId) => ipcRenderer.invoke('cne-desktop:relink-folder', folderId),
  openVaultResource: (location) => (
    ipcRenderer.invoke('cne-desktop:open-vault-resource', location)
  ),
  revealVaultResource: (location) => (
    ipcRenderer.invoke('cne-desktop:reveal-vault-resource', location)
  ),
  selectExternalLinkFile: () => ipcRenderer.invoke('cne-desktop:select-external-link-file'),
  registerDroppedExternalLinkFile,
  describeExternalLinkFile: (fileRef) => (
    ipcRenderer.invoke('cne-desktop:describe-external-link-file', fileRef)
  ),
  openExternalLinkTarget: (target) => (
    ipcRenderer.invoke('cne-desktop:open-external-link-target', target)
  )
}));
