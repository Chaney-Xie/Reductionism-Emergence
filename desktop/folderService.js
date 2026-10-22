const fs = require('fs/promises');
const path = require('path');
const {
  nextFolderId,
  normalizeFolderRegistry,
  withDefaultFolder,
  withRegisteredFolder
} = require('./folderRegistry');
const { folderRootsForVault, setFolderRoot } = require('./desktopSettings');

class FolderRegistryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FolderRegistryError';
    this.code = code;
  }
}

async function canonicalFolderRoot(candidate, { fsImpl = fs } = {}) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
    throw new FolderRegistryError('INVALID_FOLDER', 'Select a valid folder.');
  }
  try {
    const realRoot = await fsImpl.realpath(candidate);
    const stat = await fsImpl.stat(realRoot);
    if (!stat.isDirectory()) throw new Error('not a directory');
    if (path.parse(realRoot).root === realRoot) {
      throw new FolderRegistryError('FILESYSTEM_ROOT', 'The filesystem root cannot be registered.');
    }
    return realRoot;
  } catch (error) {
    if (error instanceof FolderRegistryError) throw error;
    throw new FolderRegistryError('FOLDER_UNAVAILABLE', 'The selected folder is unavailable.');
  }
}

async function folderRegistryView(registry, settings, vaultId, { fsImpl = fs } = {}) {
  const normalized = normalizeFolderRegistry(registry);
  const mappings = folderRootsForVault(settings, vaultId);
  const folders = [];
  for (const folder of normalized.folders) {
    const configuredRoot = mappings[folder.id];
    let available = false;
    let error = null;
    let realRoot = null;
    if (!configuredRoot) {
      error = 'Folder link lost. Relink this folder.';
    } else {
      try {
        realRoot = await canonicalFolderRoot(configuredRoot, { fsImpl });
        available = true;
      } catch (failure) {
        error = failure.code === 'FOLDER_UNAVAILABLE'
          ? 'Folder link lost. Relink this folder.'
          : failure.message;
      }
    }
    const currentName = available ? path.basename(realRoot) || folder.name : folder.name;
    folders.push({
      id: folder.id,
      name: currentName,
      isDefault: folder.id === normalized.defaultFolderId,
      available,
      error,
      realRoot
    });
  }
  return { version: 1, defaultFolderId: normalized.defaultFolderId, folders };
}

function publicFolderRegistryState(view) {
  return {
    version: 1,
    defaultFolderId: view.defaultFolderId,
    folders: view.folders.map(({ id, name, isDefault, available, error }) => ({
      id, name, isDefault, available, error
    }))
  };
}

function createFolderService({
  vaultId,
  loadRegistry,
  saveRegistry,
  loadSettings,
  saveSettings,
  selectFolder,
  fsImpl = fs
}) {
  async function state() {
    const registry = normalizeFolderRegistry(await loadRegistry());
    const view = await folderRegistryView(registry, await loadSettings(), vaultId, { fsImpl });
    let nextRegistry = registry;
    for (const folder of view.folders) {
      const saved = nextRegistry.folders.find((item) => item.id === folder.id);
      if (folder.available && saved?.name !== folder.name) {
        nextRegistry = withRegisteredFolder(nextRegistry, { id: folder.id, name: folder.name });
      }
    }
    if (nextRegistry !== registry) await saveRegistry(nextRegistry);
    return publicFolderRegistryState(view);
  }

  async function chooseFolder({ role, folderId = null } = {}) {
    const selected = await selectFolder();
    if (!selected) return { ok: false, cancelled: true };
    const realRoot = await canonicalFolderRoot(selected, { fsImpl });
    const registry = normalizeFolderRegistry(await loadRegistry());
    const settings = await loadSettings();
    const currentView = await folderRegistryView(registry, settings, vaultId, { fsImpl });
    const duplicate = currentView.folders.find((folder) => folder.realRoot === realRoot);

    if (role === 'relink') {
      const target = registry.folders.find((folder) => folder.id === folderId);
      if (!target) throw new FolderRegistryError('UNKNOWN_FOLDER', 'The registered folder no longer exists.');
      if (duplicate && duplicate.id !== folderId) {
        throw new FolderRegistryError('DUPLICATE_FOLDER', 'This folder is already registered.');
      }
      const nextSettings = setFolderRoot(settings, vaultId, folderId, realRoot);
      const nextRegistry = withRegisteredFolder(registry, {
        id: folderId,
        name: path.basename(realRoot) || target.name
      });
      await saveSettings(nextSettings);
      try {
        await saveRegistry(nextRegistry);
      } catch (error) {
        await saveSettings(settings).catch(() => {});
        throw error;
      }
      return { ok: true, changed: true, registry: await state() };
    }

    if (duplicate) {
      if (role === 'default' && registry.defaultFolderId !== duplicate.id) {
        await saveRegistry(withDefaultFolder(registry, duplicate.id));
        return { ok: true, changed: true, registry: await state() };
      }
      return { ok: true, changed: false, existingFolderId: duplicate.id, registry: await state() };
    }

    const id = nextFolderId(registry);
    const folder = { id, name: path.basename(realRoot) || id };
    const nextRegistry = withRegisteredFolder(registry, folder, { makeDefault: role === 'default' });
    const nextSettings = setFolderRoot(settings, vaultId, id, realRoot);
    await saveSettings(nextSettings);
    try {
      await saveRegistry(nextRegistry);
    } catch (error) {
      await saveSettings(settings).catch(() => {});
      throw error;
    }
    return { ok: true, changed: true, folderId: id, registry: await state() };
  }

  async function setDefault(folderId) {
    const registry = normalizeFolderRegistry(await loadRegistry());
    const next = withDefaultFolder(registry, folderId);
    if (next.defaultFolderId === registry.defaultFolderId) {
      return { ok: true, changed: false, registry: await state() };
    }
    await saveRegistry(next);
    return { ok: true, changed: true, registry: await state() };
  }

  return {
    addReadOnlyFolder: () => chooseFolder({ role: 'readonly' }),
    chooseDefaultFolder: () => chooseFolder({ role: 'default' }),
    relinkFolder: (folderId) => chooseFolder({ role: 'relink', folderId }),
    setDefaultFolder: setDefault,
    state
  };
}

module.exports = {
  FolderRegistryError,
  canonicalFolderRoot,
  createFolderService,
  folderRegistryView,
  publicFolderRegistryState
};
