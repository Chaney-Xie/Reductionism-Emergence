const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { isPathInside } = require('./vaultPaths');
const { folderRegistryView } = require('./folderService');
const { normalizeFolderRegistry } = require('./folderRegistry');
const {
  DISPLAYABLE_IMAGE_EXTENSIONS,
  mimeTypeForFilename,
  validateSelectedFiles
} = require('./selectedFileService');

const DEFAULT_FOLDER_MESSAGE = 'Choose or relink a default folder in Vault Settings > Links.';

class FolderFileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FolderFileError';
    this.code = code;
  }
}

function contentHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function copyWithSafeCollision(sourcePath, destinationRoot, { fsImpl = fs } = {}) {
  await fsImpl.mkdir(destinationRoot, { recursive: true });
  const originalName = path.basename(sourcePath).replace(/[\0-\x1f\x7f]/g, '').trim() || 'file';
  const parsed = path.parse(originalName);
  const source = await fsImpl.readFile(sourcePath);
  const sourceHash = contentHash(source);
  for (let number = 0; number < 1000; number += 1) {
    const filename = number ? `${parsed.name}_${number}${parsed.ext}` : originalName;
    const destination = path.join(destinationRoot, filename);
    try {
      const existing = await fsImpl.readFile(destination);
      if (contentHash(existing) === sourceHash) {
        return { absolutePath: destination, filename, created: false };
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        await fsImpl.writeFile(destination, source, { flag: 'wx' });
        return { absolutePath: destination, filename, created: true };
      } catch (writeError) {
        if (writeError.code !== 'EEXIST') throw writeError;
      }
    }
  }
  throw new FolderFileError('COPY_COLLISION', `Could not copy ${originalName} safely.`);
}

function folderContainingFile(file, folders) {
  return folders
    .filter((folder) => folder.available && folder.realRoot && isPathInside(folder.realRoot, file.realPath))
    .sort((left, right) => right.realRoot.length - left.realRoot.length)[0] || null;
}

async function descriptorForFile(file, folder, absolutePath, { readImageSize, fsImpl = fs }) {
  const originalName = path.basename(absolutePath);
  const extension = path.extname(originalName).toLowerCase();
  const displayable = DISPLAYABLE_IMAGE_EXTENSIONS.has(extension);
  const relativePath = path.relative(folder.realRoot, absolutePath).split(path.sep).join('/');
  const stat = await fsImpl.stat(absolutePath);
  const dimensions = displayable ? await readImageSize(absolutePath) : null;
  return {
    type: 'folder',
    folderId: folder.id,
    relativePath,
    originalName,
    fileName: originalName,
    mimeType: mimeTypeForFilename(originalName),
    resourceType: extension.slice(1) || 'unknown',
    displayable,
    size: stat.size,
    ...(dimensions && Number.isFinite(dimensions.width) && Number.isFinite(dimensions.height)
      ? { naturalWidth: dimensions.width, naturalHeight: dimensions.height }
      : {})
  };
}

async function descriptorForVaultFile(absolutePath, assetFolder, {
  readImageSize,
  fsImpl = fs
}) {
  const originalName = path.basename(absolutePath);
  const extension = path.extname(originalName).toLowerCase();
  const displayable = DISPLAYABLE_IMAGE_EXTENSIONS.has(extension);
  const stat = await fsImpl.stat(absolutePath);
  const dimensions = displayable ? await readImageSize(absolutePath) : null;
  return {
    type: 'vault',
    relativePath: `assets/${assetFolder}/${originalName}`,
    originalName,
    fileName: originalName,
    mimeType: mimeTypeForFilename(originalName),
    resourceType: extension.slice(1) || 'unknown',
    displayable,
    size: stat.size,
    ...(dimensions && Number.isFinite(dimensions.width) && Number.isFinite(dimensions.height)
      ? { naturalWidth: dimensions.width, naturalHeight: dimensions.height }
      : {})
  };
}

function createFolderFileService({
  vaultId,
  vaultRoot = null,
  loadRegistry,
  loadSettings,
  selectFiles,
  readImageSize = async () => null,
  fsImpl = fs
}) {
  async function prepareFiles({ selectedPaths: suppliedPaths } = {}) {
    const selectedPaths = Array.isArray(suppliedPaths) ? suppliedPaths : await selectFiles();
    if (!selectedPaths?.length) return { ok: false, cancelled: true };
    const files = await validateSelectedFiles(selectedPaths, { fsImpl });
    const registry = normalizeFolderRegistry(await loadRegistry());
    const settings = await loadSettings();
    const view = await folderRegistryView(registry, settings, vaultId, { fsImpl });
    const defaultFolder = view.folders.find((folder) => folder.id === view.defaultFolderId);
    const prepared = [];
    const createdFiles = [];

    try {
      for (const file of files) {
        let folder = folderContainingFile(file, view.folders);
        let absolutePath = file.realPath;
        if (!folder) {
          if (defaultFolder?.available) {
            const copied = await copyWithSafeCollision(file.realPath, defaultFolder.realRoot, { fsImpl });
            folder = defaultFolder;
            absolutePath = copied.absolutePath;
            if (copied.created) createdFiles.push(copied.absolutePath);
          } else {
            if (typeof vaultRoot !== 'string' || !path.isAbsolute(vaultRoot)) {
              throw new FolderFileError('DEFAULT_FOLDER_UNAVAILABLE', DEFAULT_FOLDER_MESSAGE);
            }
            const extension = path.extname(file.realPath).toLowerCase();
            const assetFolder = DISPLAYABLE_IMAGE_EXTENSIONS.has(extension) ? 'images' : 'resources';
            const copied = await copyWithSafeCollision(
              file.realPath,
              path.join(vaultRoot, 'assets', assetFolder),
              { fsImpl }
            );
            if (copied.created) createdFiles.push(copied.absolutePath);
            prepared.push(await descriptorForVaultFile(
              copied.absolutePath,
              assetFolder,
              { readImageSize, fsImpl }
            ));
            continue;
          }
        }
        prepared.push(await descriptorForFile(file, folder, absolutePath, { readImageSize, fsImpl }));
      }
    } catch (error) {
      await Promise.all(createdFiles.map((filePath) => fsImpl.rm(filePath, { force: true }).catch(() => {})));
      throw error;
    }

    let rolledBack = false;
    const rollbackCopies = async () => {
      if (rolledBack) return;
      await Promise.all(createdFiles.map((filePath) => fsImpl.rm(filePath, { force: true })));
      rolledBack = true;
    };
    return {
      ok: true,
      files: prepared,
      copiedCount: createdFiles.length,
      rollbackCopies
    };
  }

  return { prepareFiles };
}

module.exports = {
  DEFAULT_FOLDER_MESSAGE,
  FolderFileError,
  copyWithSafeCollision,
  createFolderFileService,
  folderContainingFile
};
