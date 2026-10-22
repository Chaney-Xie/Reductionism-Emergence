const fs = require('fs/promises');
const path = require('path');

const FOLDER_ID_PATTERN = /^folder_[a-z0-9_-]+$/i;

function normalizeFolderRegistry(value) {
  const folders = [];
  const seen = new Set();
  for (const raw of Array.isArray(value?.folders) ? value.folders : []) {
    if (!raw || typeof raw !== 'object') continue;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!FOLDER_ID_PATTERN.test(id) || seen.has(id)) continue;
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id;
    seen.add(id);
    folders.push({ id, name });
  }
  const defaultFolderId = typeof value?.defaultFolderId === 'string'
    && seen.has(value.defaultFolderId)
    ? value.defaultFolderId
    : null;
  return { version: 1, folders, defaultFolderId };
}

function nextFolderId(registry) {
  const used = new Set(normalizeFolderRegistry(registry).folders.map((folder) => folder.id));
  let number = 1;
  while (used.has(`folder_${String(number).padStart(3, '0')}`)) number += 1;
  return `folder_${String(number).padStart(3, '0')}`;
}

function withRegisteredFolder(registry, folder, { makeDefault = false } = {}) {
  const current = normalizeFolderRegistry(registry);
  const existing = current.folders.find((item) => item.id === folder.id);
  const folders = existing
    ? current.folders.map((item) => item.id === folder.id ? { id: item.id, name: folder.name } : item)
    : [...current.folders, { id: folder.id, name: folder.name }];
  return normalizeFolderRegistry({
    folders,
    defaultFolderId: makeDefault ? folder.id : current.defaultFolderId
  });
}

function withDefaultFolder(registry, folderId) {
  const current = normalizeFolderRegistry(registry);
  if (current.defaultFolderId === folderId) return current;
  if (!current.folders.some((folder) => folder.id === folderId)) {
    throw new TypeError('A registered folder ID is required.');
  }
  return { ...current, defaultFolderId: folderId };
}

function withoutRegisteredFolder(registry, folderId) {
  const current = normalizeFolderRegistry(registry);
  if (current.defaultFolderId === folderId) {
    throw new TypeError('The default folder cannot be removed.');
  }
  return normalizeFolderRegistry({
    folders: current.folders.filter((folder) => folder.id !== folderId),
    defaultFolderId: current.defaultFolderId
  });
}

async function readFolderRegistry(vaultRoot, { fsImpl = fs } = {}) {
  const registryPath = path.join(vaultRoot, 'resourceFolders.json');
  try {
    return normalizeFolderRegistry(JSON.parse(await fsImpl.readFile(registryPath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return normalizeFolderRegistry(null);
    if (error instanceof SyntaxError) throw new Error('resourceFolders.json contains invalid JSON.');
    throw error;
  }
}

async function writeFolderRegistry(vaultRoot, value, { fsImpl = fs } = {}) {
  const normalized = normalizeFolderRegistry(value);
  const registryPath = path.join(vaultRoot, 'resourceFolders.json');
  const temporaryPath = `${registryPath}.${process.pid}.${Date.now()}.tmp`;
  await fsImpl.mkdir(path.dirname(registryPath), { recursive: true });
  try {
    await fsImpl.writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    await fsImpl.rename(temporaryPath, registryPath);
  } catch (error) {
    await fsImpl.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  return normalized;
}

module.exports = {
  FOLDER_ID_PATTERN,
  nextFolderId,
  normalizeFolderRegistry,
  readFolderRegistry,
  withDefaultFolder,
  withRegisteredFolder,
  withoutRegisteredFolder,
  writeFolderRegistry
};
