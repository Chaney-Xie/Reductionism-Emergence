const fs = require('fs/promises');
const path = require('path');

const MIN_ZOOM_SENSITIVITY = 0.5;
const MAX_ZOOM_SENSITIVITY = 5;
const DEFAULT_ZOOM_SENSITIVITY = 1;
const DEFAULT_NAVIGATION_SORT_MODE = 'name_asc';
const NAVIGATION_SORT_MODES = new Set([
  'name_asc',
  'name_desc',
  'modified_desc',
  'modified_asc',
  'created_desc',
  'created_asc'
]);

function normalizeZoomSensitivity(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)
    || value < MIN_ZOOM_SENSITIVITY || value > MAX_ZOOM_SENSITIVITY) {
    return DEFAULT_ZOOM_SENSITIVITY;
  }
  return Number(value.toFixed(1));
}

function normalizeNavigationSortMode(value) {
  return NAVIGATION_SORT_MODES.has(value) ? value : DEFAULT_NAVIGATION_SORT_MODE;
}

function normalizeDesktopSettings(value) {
  const workspaceRootsByVaultId = {};
  const folderRootsByVaultId = {};
  const externalFileTargetsByVaultId = {};
  const zoomSensitivitiesByVaultId = {};
  const navigationSortModesByVaultId = {};
  if (value?.workspaceRootsByVaultId && typeof value.workspaceRootsByVaultId === 'object') {
    for (const [vaultId, rawMappings] of Object.entries(value.workspaceRootsByVaultId)) {
      if (!/^[a-z0-9_-]+$/i.test(vaultId)
        || !rawMappings || typeof rawMappings !== 'object' || Array.isArray(rawMappings)) continue;
      const mappings = {};
      for (const [workspaceId, workspaceRoot] of Object.entries(rawMappings)) {
        if (!/^[a-z0-9_-]+$/i.test(workspaceId)
          || typeof workspaceRoot !== 'string' || !workspaceRoot.trim()
          || !path.isAbsolute(workspaceRoot)) continue;
        mappings[workspaceId] = path.resolve(workspaceRoot);
      }
      if (Object.keys(mappings).length) workspaceRootsByVaultId[vaultId] = mappings;
    }
  }
  if (value?.folderRootsByVaultId && typeof value.folderRootsByVaultId === 'object') {
    for (const [vaultId, rawMappings] of Object.entries(value.folderRootsByVaultId)) {
      if (!/^[a-z0-9_-]+$/i.test(vaultId)
        || !rawMappings || typeof rawMappings !== 'object' || Array.isArray(rawMappings)) continue;
      const mappings = {};
      for (const [folderId, folderRoot] of Object.entries(rawMappings)) {
        if (!/^folder_[a-z0-9_-]+$/i.test(folderId)
          || typeof folderRoot !== 'string' || !folderRoot.trim()
          || !path.isAbsolute(folderRoot)) continue;
        mappings[folderId] = path.resolve(folderRoot);
      }
      if (Object.keys(mappings).length) folderRootsByVaultId[vaultId] = mappings;
    }
  }
  if (value?.externalFileTargetsByVaultId
    && typeof value.externalFileTargetsByVaultId === 'object'
    && !Array.isArray(value.externalFileTargetsByVaultId)) {
    for (const [vaultId, rawMappings] of Object.entries(value.externalFileTargetsByVaultId)) {
      if (!/^[a-z0-9_-]+$/i.test(vaultId)
        || !rawMappings || typeof rawMappings !== 'object' || Array.isArray(rawMappings)) continue;
      const mappings = {};
      for (const [externalFileId, targetPath] of Object.entries(rawMappings)) {
        if (!/^external_file_[a-z0-9_-]+$/i.test(externalFileId)
          || typeof targetPath !== 'string' || !targetPath.trim()
          || !path.isAbsolute(targetPath)) continue;
        mappings[externalFileId] = path.resolve(targetPath);
      }
      if (Object.keys(mappings).length) externalFileTargetsByVaultId[vaultId] = mappings;
    }
  }
  if (value?.zoomSensitivitiesByVaultId
    && typeof value.zoomSensitivitiesByVaultId === 'object'
    && !Array.isArray(value.zoomSensitivitiesByVaultId)) {
    for (const [vaultId, sensitivity] of Object.entries(value.zoomSensitivitiesByVaultId)) {
      if (!/^[a-z0-9_-]+$/i.test(vaultId)
        || typeof sensitivity !== 'number' || !Number.isFinite(sensitivity)
        || sensitivity < MIN_ZOOM_SENSITIVITY || sensitivity > MAX_ZOOM_SENSITIVITY) continue;
      zoomSensitivitiesByVaultId[vaultId] = normalizeZoomSensitivity(sensitivity);
    }
  }
  if (value?.navigationSortModesByVaultId
    && typeof value.navigationSortModesByVaultId === 'object'
    && !Array.isArray(value.navigationSortModesByVaultId)) {
    for (const [vaultId, sortMode] of Object.entries(value.navigationSortModesByVaultId)) {
      if (!/^[a-z0-9_-]+$/i.test(vaultId) || !NAVIGATION_SORT_MODES.has(sortMode)) continue;
      navigationSortModesByVaultId[vaultId] = sortMode;
    }
  }
  return {
    version: 5,
    zoomSensitivity: normalizeZoomSensitivity(value?.zoomSensitivity),
    workspaceRootsByVaultId,
    folderRootsByVaultId,
    externalFileTargetsByVaultId,
    zoomSensitivitiesByVaultId,
    navigationSortModesByVaultId
  };
}

function withZoomSensitivity(settings, value) {
  return normalizeDesktopSettings({
    ...normalizeDesktopSettings(settings),
    zoomSensitivity: normalizeZoomSensitivity(value)
  });
}

function zoomSensitivityForVault(settings, vaultId) {
  if (!/^[a-z0-9_-]+$/i.test(vaultId || '')) return DEFAULT_ZOOM_SENSITIVITY;
  const current = normalizeDesktopSettings(settings);
  return current.zoomSensitivitiesByVaultId[vaultId] ?? DEFAULT_ZOOM_SENSITIVITY;
}

function withZoomSensitivityForVault(settings, vaultId, value) {
  if (!/^[a-z0-9_-]+$/i.test(vaultId || '')) throw new TypeError('A valid vault ID is required.');
  if (typeof value !== 'number' || !Number.isFinite(value)
    || value < MIN_ZOOM_SENSITIVITY || value > MAX_ZOOM_SENSITIVITY) {
    throw new TypeError('A valid zoom sensitivity is required.');
  }
  const current = normalizeDesktopSettings(settings);
  return normalizeDesktopSettings({
    ...current,
    zoomSensitivitiesByVaultId: {
      ...current.zoomSensitivitiesByVaultId,
      [vaultId]: normalizeZoomSensitivity(value)
    }
  });
}

function migrateLegacyZoomSensitivities(settings, vaultIds = []) {
  const current = normalizeDesktopSettings(settings);
  const legacySensitivity = settings?.zoomSensitivity;
  if (typeof legacySensitivity !== 'number' || !Number.isFinite(legacySensitivity)
    || legacySensitivity < MIN_ZOOM_SENSITIVITY || legacySensitivity > MAX_ZOOM_SENSITIVITY) {
    return current;
  }
  const zoomSensitivitiesByVaultId = { ...current.zoomSensitivitiesByVaultId };
  for (const vaultId of vaultIds) {
    if (!/^[a-z0-9_-]+$/i.test(vaultId || '')
      || Object.hasOwn(zoomSensitivitiesByVaultId, vaultId)) continue;
    zoomSensitivitiesByVaultId[vaultId] = current.zoomSensitivity;
  }
  return normalizeDesktopSettings({ ...current, zoomSensitivitiesByVaultId });
}

function withFolderRootsForVault(settings, vaultId, roots) {
  if (!/^[a-z0-9_-]+$/i.test(vaultId || '')) throw new TypeError('A valid vault ID is required.');
  const current = normalizeDesktopSettings(settings);
  const normalizedRoots = normalizeDesktopSettings({
    folderRootsByVaultId: { [vaultId]: roots }
  }).folderRootsByVaultId[vaultId] || {};
  const folderRootsByVaultId = { ...current.folderRootsByVaultId };
  if (Object.keys(normalizedRoots).length) folderRootsByVaultId[vaultId] = normalizedRoots;
  else delete folderRootsByVaultId[vaultId];
  return normalizeDesktopSettings({ ...current, folderRootsByVaultId });
}

function navigationSortModeForVault(settings, vaultId) {
  if (typeof vaultId !== 'string') return DEFAULT_NAVIGATION_SORT_MODE;
  return normalizeNavigationSortMode(
    normalizeDesktopSettings(settings).navigationSortModesByVaultId[vaultId]
  );
}

function explicitNavigationSortModeForVault(settings, vaultId) {
  if (!/^[a-z0-9_-]+$/i.test(vaultId || '')) return null;
  const modes = settings?.navigationSortModesByVaultId;
  if (!modes || typeof modes !== 'object' || Array.isArray(modes)) return null;
  return NAVIGATION_SORT_MODES.has(modes[vaultId]) ? modes[vaultId] : null;
}

function withNavigationSortMode(settings, vaultId, sortMode) {
  if (!/^[a-z0-9_-]+$/i.test(vaultId || '')) throw new TypeError('A valid vault ID is required.');
  if (!NAVIGATION_SORT_MODES.has(sortMode)) throw new TypeError('A valid navigation sort mode is required.');
  const current = normalizeDesktopSettings(settings);
  return normalizeDesktopSettings({
    ...current,
    navigationSortModesByVaultId: {
      ...current.navigationSortModesByVaultId,
      [vaultId]: sortMode
    }
  });
}

function folderRootsForVault(settings, vaultId) {
  if (typeof vaultId !== 'string') return {};
  return { ...(normalizeDesktopSettings(settings).folderRootsByVaultId[vaultId] || {}) };
}

function externalFileTargetForVault(settings, vaultId, externalFileId) {
  if (typeof vaultId !== 'string' || !/^external_file_[a-z0-9_-]+$/i.test(externalFileId || '')) {
    return null;
  }
  return normalizeDesktopSettings(settings).externalFileTargetsByVaultId[vaultId]?.[externalFileId]
    || null;
}

function setExternalFileTarget(settings, vaultId, externalFileId, targetPath) {
  if (!/^[a-z0-9_-]+$/i.test(vaultId || '')) throw new TypeError('A valid vault ID is required.');
  if (!/^external_file_[a-z0-9_-]+$/i.test(externalFileId || '')) {
    throw new TypeError('A valid external file ID is required.');
  }
  if (typeof targetPath !== 'string' || !targetPath.trim() || !path.isAbsolute(targetPath)) {
    throw new TypeError('An absolute external target path is required.');
  }
  const current = normalizeDesktopSettings(settings);
  return normalizeDesktopSettings({
    ...current,
    externalFileTargetsByVaultId: {
      ...current.externalFileTargetsByVaultId,
      [vaultId]: {
        ...(current.externalFileTargetsByVaultId[vaultId] || {}),
        [externalFileId]: path.resolve(targetPath)
      }
    }
  });
}

function setFolderRoot(settings, vaultId, folderId, folderRoot) {
  if (!/^[a-z0-9_-]+$/i.test(vaultId || '')) throw new TypeError('A valid vault ID is required.');
  if (!/^folder_[a-z0-9_-]+$/i.test(folderId || '')) throw new TypeError('A valid folder ID is required.');
  if (typeof folderRoot !== 'string' || !folderRoot.trim() || !path.isAbsolute(folderRoot)) {
    throw new TypeError('An absolute folder root is required.');
  }
  const current = normalizeDesktopSettings(settings);
  return normalizeDesktopSettings({
    ...current,
    folderRootsByVaultId: {
      ...current.folderRootsByVaultId,
      [vaultId]: {
        ...(current.folderRootsByVaultId[vaultId] || {}),
        [folderId]: folderRoot
      }
    }
  });
}

function removeFolderRoot(settings, vaultId, folderId) {
  const current = normalizeDesktopSettings(settings);
  const mappings = { ...(current.folderRootsByVaultId[vaultId] || {}) };
  delete mappings[folderId];
  const folderRootsByVaultId = { ...current.folderRootsByVaultId };
  if (Object.keys(mappings).length) folderRootsByVaultId[vaultId] = mappings;
  else delete folderRootsByVaultId[vaultId];
  return normalizeDesktopSettings({ ...current, folderRootsByVaultId });
}

function workspaceRootsForVault(settings, vaultId) {
  if (typeof vaultId !== 'string') return {};
  return { ...(normalizeDesktopSettings(settings).workspaceRootsByVaultId[vaultId] || {}) };
}

function createDesktopSettings({ userDataDir, fsImpl = fs }) {
  if (typeof userDataDir !== 'string' || !userDataDir) {
    throw new TypeError('A desktop user-data directory is required.');
  }
  const settingsPath = path.join(userDataDir, 'global-settings.json');
  const legacySettingsPath = path.join(userDataDir, 'desktop-settings.json');

  async function loadRaw(filePath) {
    try {
      return JSON.parse(await fsImpl.readFile(filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async function loadLegacyRaw() {
    return (await loadRaw(settingsPath)) || (await loadRaw(legacySettingsPath));
  }

  async function load() {
    return normalizeDesktopSettings(await loadLegacyRaw());
  }

  async function save(value) {
    const normalized = normalizeDesktopSettings(value);
    const {
      lastVaultPath,
      workspaceStatesByVaultId,
      zoomSensitivity,
      version,
      ...machineSettings
    } = normalized;
    const persisted = { schemaVersion: 1, ...machineSettings };
    await fsImpl.mkdir(userDataDir, { recursive: true });
    const temporaryPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fsImpl.writeFile(temporaryPath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
      await fsImpl.rename(temporaryPath, settingsPath);
    } catch (error) {
      await fsImpl.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
    return normalized;
  }

  async function update(patch) {
    const current = await load();
    return save({ ...current, ...patch });
  }

  return { legacySettingsPath, load, loadLegacyRaw, save, update, settingsPath };
}

module.exports = {
  DEFAULT_NAVIGATION_SORT_MODE,
  DEFAULT_ZOOM_SENSITIVITY,
  MAX_ZOOM_SENSITIVITY,
  MIN_ZOOM_SENSITIVITY,
  createDesktopSettings,
  explicitNavigationSortModeForVault,
  externalFileTargetForVault,
  folderRootsForVault,
  navigationSortModeForVault,
  normalizeDesktopSettings,
  normalizeNavigationSortMode,
  normalizeZoomSensitivity,
  migrateLegacyZoomSensitivities,
  removeFolderRoot,
  setFolderRoot,
  setExternalFileTarget,
  withZoomSensitivity,
  withZoomSensitivityForVault,
  withFolderRootsForVault,
  withNavigationSortMode,
  workspaceRootsForVault,
  zoomSensitivityForVault
};
