const fs = require('fs/promises');
const path = require('path');

const REQUIRED_VAULT_PATHS = [
  ['pages', 'directory'],
  ['assets', 'directory'],
  ['assets/images', 'directory'],
  ['assets/resources', 'directory'],
  ['vault.json', 'file'],
  ['pageIndex.json', 'file'],
  ['navigation.json', 'file'],
  ['categories.json', 'file'],
  ['descriptors.json', 'file'],
  ['vocabulary.json', 'file'],
  ['linkTypes.json', 'file'],
  ['workspaceState.json', 'file']
];

class VaultPathError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VaultPathError';
    this.code = code;
  }
}

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..'
    && !path.isAbsolute(relative));
}

async function validateVaultRoot(candidatePath, { fsImpl = fs } = {}) {
  if (typeof candidatePath !== 'string' || !candidatePath.trim()) {
    return { valid: false, error: 'Select a folder containing an existing Viewer vault.' };
  }

  let vaultRoot;
  try {
    vaultRoot = await fsImpl.realpath(path.resolve(candidatePath));
    const rootStat = await fsImpl.stat(vaultRoot);
    if (!rootStat.isDirectory()) {
      return { valid: false, error: 'The selected item is not a folder.' };
    }
  } catch {
    return { valid: false, error: 'The selected folder is unavailable.' };
  }

  const missing = [];
  for (const [relativePath, expectedType] of REQUIRED_VAULT_PATHS) {
    try {
      const itemStat = await fsImpl.stat(path.join(vaultRoot, relativePath));
      const matches = expectedType === 'file' ? itemStat.isFile() : itemStat.isDirectory();
      if (!matches) missing.push(relativePath);
    } catch {
      missing.push(relativePath);
    }
  }
  if (missing.length) {
    return {
      valid: false,
      error: `This folder is not a Viewer vault. Missing: ${missing.join(', ')}.`,
      missing
    };
  }

  try {
    const [metadata, pageIndex, navigation] = await Promise.all([
      fsImpl.readFile(path.join(vaultRoot, 'vault.json'), 'utf8').then(JSON.parse),
      fsImpl.readFile(path.join(vaultRoot, 'pageIndex.json'), 'utf8').then(JSON.parse),
      fsImpl.readFile(path.join(vaultRoot, 'navigation.json'), 'utf8').then(JSON.parse)
    ]);
    if (!metadata || typeof metadata !== 'object'
      || typeof metadata.vaultId !== 'string'
      || typeof metadata.displayName !== 'string') {
      return { valid: false, error: 'vault.json does not contain valid Vault metadata.' };
    }
    if (!pageIndex || !Array.isArray(pageIndex.pages)) {
      return { valid: false, error: 'pageIndex.json is not a valid page index.' };
    }
    if (!navigation || typeof navigation !== 'object'
      || !Array.isArray(navigation.items)
      || !Array.isArray(navigation.folders)) {
      return { valid: false, error: 'navigation.json is not valid navigation data.' };
    }
    return {
      valid: true,
      vaultRoot,
      vaultId: metadata.vaultId,
      displayName: metadata.displayName,
      projectId: metadata.vaultId,
      projectName: metadata.displayName
    };
  } catch {
    return { valid: false, error: 'The selected Vault contains unreadable JSON.' };
  }
}

function normalizeResourceRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new VaultPathError('INVALID_PATH', 'A vault-relative resource path is required.');
  }
  if (/[\0-\x1f\x7f]/.test(relativePath)) {
    throw new VaultPathError('INVALID_PATH', 'The resource path is invalid.');
  }

  const portablePath = relativePath.trim().replace(/\\/g, '/');
  if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)
    || portablePath.startsWith('/')) {
    throw new VaultPathError('ABSOLUTE_PATH', 'Absolute resource paths are not allowed.');
  }

  if (portablePath.split('/').includes('..')) {
    throw new VaultPathError('PATH_TRAVERSAL', 'The resource path leaves the selected vault.');
  }

  const normalized = path.posix.normalize(portablePath);
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new VaultPathError('PATH_TRAVERSAL', 'The resource path leaves the selected vault.');
  }
  if (!(normalized.startsWith('assets/images/')
    || normalized.startsWith('assets/resources/'))) {
    throw new VaultPathError('UNSUPPORTED_PATH', 'Only Viewer image and resource files can be opened.');
  }
  return normalized;
}

function normalizeWorkspaceRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new VaultPathError('INVALID_PATH', 'A workspace-relative resource path is required.');
  }
  if (/[\0-\x1f\x7f]/.test(relativePath)) {
    throw new VaultPathError('INVALID_PATH', 'The resource path is invalid.');
  }
  const portablePath = relativePath.trim().replace(/\\/g, '/');
  if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)
    || portablePath.startsWith('/')) {
    throw new VaultPathError('ABSOLUTE_PATH', 'Absolute resource paths are not allowed.');
  }
  if (portablePath.split('/').includes('..')) {
    throw new VaultPathError('PATH_TRAVERSAL', 'The resource path leaves the registered workspace.');
  }
  const normalized = path.posix.normalize(portablePath);
  if (!normalized || normalized === '.') {
    throw new VaultPathError('INVALID_PATH', 'A workspace-relative resource path is required.');
  }
  return normalized;
}

function normalizeResourceLocationInput(value) {
  if (typeof value === 'string') {
    return { type: 'vault', relativePath: normalizeResourceRelativePath(value) };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new VaultPathError('INVALID_LOCATION', 'A resource location is required.');
  }
  const raw = value.location && typeof value.location === 'object' ? value.location : value;
  const type = raw.type || (typeof value.src === 'string' ? 'vault' : null);
  if (type === 'vault') {
    return {
      type,
      relativePath: normalizeResourceRelativePath(raw.relativePath || raw.src || value.src)
    };
  }
  if (type === 'workspace') {
    if (typeof raw.workspaceId !== 'string' || !/^[a-z0-9_-]+$/i.test(raw.workspaceId)) {
      throw new VaultPathError('INVALID_WORKSPACE', 'A valid workspace ID is required.');
    }
    return {
      type,
      workspaceId: raw.workspaceId,
      relativePath: normalizeWorkspaceRelativePath(raw.relativePath)
    };
  }
  if (type === 'folder') {
    if (typeof raw.folderId !== 'string' || !/^folder_[a-z0-9_-]+$/i.test(raw.folderId)) {
      throw new VaultPathError('INVALID_FOLDER', 'A valid folder ID is required.');
    }
    return {
      type,
      folderId: raw.folderId,
      relativePath: normalizeWorkspaceRelativePath(raw.relativePath)
    };
  }
  throw new VaultPathError('INVALID_LOCATION', 'Unknown resource location type.');
}

async function resolveContainedFile(rootPath, relativePath, {
  fsImpl = fs,
  missingMessage = 'File not found.',
  traversalMessage = 'The resource path leaves its allowed root.'
} = {}) {
  let realRoot;
  try {
    realRoot = await fsImpl.realpath(path.resolve(rootPath));
    if (!(await fsImpl.stat(realRoot)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new VaultPathError('INVALID_ROOT', 'The resource root is unavailable.');
  }
  const candidatePath = path.resolve(realRoot, ...relativePath.split('/'));
  if (!isPathInside(realRoot, candidatePath)) {
    throw new VaultPathError('PATH_TRAVERSAL', traversalMessage);
  }
  let realPath;
  let resourceStat;
  try {
    realPath = await fsImpl.realpath(candidatePath);
    resourceStat = await fsImpl.stat(realPath);
  } catch {
    throw new VaultPathError('NOT_FOUND', missingMessage);
  }
  if (!isPathInside(realRoot, realPath)) {
    throw new VaultPathError('SYMLINK_ESCAPE', traversalMessage);
  }
  if (!resourceStat.isFile()) {
    throw new VaultPathError('NOT_A_FILE', 'The selected resource is not a file.');
  }
  return realPath;
}

async function resolveVaultResourcePath(vaultRoot, relativePath, { fsImpl = fs } = {}) {
  const normalized = normalizeResourceRelativePath(relativePath);
  let realVaultRoot;
  let realAssetsRoot;
  try {
    realVaultRoot = await fsImpl.realpath(path.resolve(vaultRoot));
    realAssetsRoot = await fsImpl.realpath(path.join(realVaultRoot, 'assets'));
  } catch {
    throw new VaultPathError('INVALID_VAULT', 'The selected vault is unavailable.');
  }

  const candidatePath = path.resolve(realVaultRoot, ...normalized.split('/'));
  if (!isPathInside(realAssetsRoot, candidatePath)) {
    throw new VaultPathError('PATH_TRAVERSAL', 'The resource path leaves the selected vault.');
  }

  let realPath;
  let resourceStat;
  try {
    realPath = await fsImpl.realpath(candidatePath);
    resourceStat = await fsImpl.stat(realPath);
  } catch {
    throw new VaultPathError('NOT_FOUND', 'File not found.');
  }
  if (!isPathInside(realVaultRoot, realPath) || !isPathInside(realAssetsRoot, realPath)) {
    throw new VaultPathError('SYMLINK_ESCAPE', 'The resource path leaves the selected vault.');
  }
  if (!resourceStat.isFile()) {
    throw new VaultPathError('NOT_A_FILE', 'The selected resource is not a file.');
  }

  return { absolutePath: realPath, relativePath: normalized };
}

async function resolveWorkspaceResourcePath(workspaceRoot, relativePath, { fsImpl = fs } = {}) {
  const normalized = normalizeWorkspaceRelativePath(relativePath);
  const absolutePath = await resolveContainedFile(workspaceRoot, normalized, {
    fsImpl,
    traversalMessage: 'The resource path leaves the registered workspace.'
  });
  return { absolutePath, relativePath: normalized };
}

async function resolveResourceLocation(vaultRoot, input, {
  workspaceDefinitions = { workspaces: {} },
  workspaceRoots = {},
  folderRegistry = { folders: [] },
  folderRoots = {},
  fsImpl = fs
} = {}) {
  const location = normalizeResourceLocationInput(input);
  if (location.type === 'vault') {
    const resolved = await resolveVaultResourcePath(vaultRoot, location.relativePath, { fsImpl });
    return { ...resolved, location };
  }

  if (location.type === 'folder') {
    if (!folderRegistry?.folders?.some((folder) => folder.id === location.folderId)) {
      throw new VaultPathError('UNKNOWN_FOLDER', 'This resource uses an unknown registered folder.');
    }
    const folderRoot = folderRoots?.[location.folderId];
    if (typeof folderRoot !== 'string' || !folderRoot.trim()) {
      throw new VaultPathError('FOLDER_UNMAPPED', 'This folder is not connected on this Mac.');
    }
    const resolved = await resolveWorkspaceResourcePath(folderRoot, location.relativePath, { fsImpl });
    return { ...resolved, location };
  }

  if (!workspaceDefinitions?.workspaces?.[location.workspaceId]) {
    throw new VaultPathError('UNKNOWN_WORKSPACE', 'This resource uses an unknown workspace.');
  }
  const workspaceRoot = workspaceRoots?.[location.workspaceId];
  if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) {
    throw new VaultPathError(
      'WORKSPACE_UNMAPPED',
      'This workspace is not connected on this Mac.'
    );
  }
  const resolved = await resolveWorkspaceResourcePath(
    workspaceRoot,
    location.relativePath,
    { fsImpl }
  );
  return { ...resolved, location };
}

module.exports = {
  REQUIRED_VAULT_PATHS,
  VaultPathError,
  isPathInside,
  normalizeResourceLocationInput,
  normalizeResourceRelativePath,
  normalizeWorkspaceRelativePath,
  resolveResourceLocation,
  resolveVaultResourcePath,
  resolveWorkspaceResourcePath,
  validateVaultRoot
};
