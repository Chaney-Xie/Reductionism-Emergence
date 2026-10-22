const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { normalizeResourceLocation } = require('../public/resourceLocations');
const { normalizeWebUrl } = require('../public/externalLinks');
const {
  externalFileTargetForVault,
  folderRootsForVault
} = require('./desktopSettings');

function publicError(error, fallback) {
  return error?.message || fallback;
}

function pathIsWithin(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

async function exactFilenameCandidates(fsImpl, roots, filename, { limit = 2 } = {}) {
  const matches = new Set();
  const pending = [...new Set(roots.map((root) => path.resolve(root)))];
  while (pending.length && matches.size < limit) {
    const directory = pending.pop();
    const entries = await fsImpl.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isSymbolicLink?.()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory?.()) {
        if (entry.name === filename && path.extname(entry.name).toLowerCase() === '.app') {
          matches.add(absolutePath);
        } else if (path.extname(entry.name).toLowerCase() !== '.app') {
          pending.push(absolutePath);
        }
      } else if (entry.isFile?.() && entry.name === filename) {
        matches.add(absolutePath);
      }
      if (matches.size >= limit) break;
    }
  }
  return [...matches];
}

function createExternalLinkActions({
  vaultId,
  loadSettings,
  storeExternalTarget,
  selectFile,
  resolveFileRef,
  openPath,
  openExternal,
  fsImpl = fs,
  logger = console
}) {
  async function registerExternalFile(selectedPath) {
    const absolutePath = path.resolve(selectedPath);
    const stat = await fsImpl.stat(absolutePath);
    const selectablePackage = stat.isDirectory() && path.extname(absolutePath).toLowerCase() === '.app';
    if (!stat.isFile() && !selectablePackage) {
      throw new Error('Select a local file or application.');
    }
    const externalFileId = `external_file_${crypto.randomUUID().replace(/-/g, '')}`;
    if (typeof storeExternalTarget !== 'function') {
      throw new Error('External file settings are unavailable.');
    }
    await storeExternalTarget(externalFileId, absolutePath);
    return {
      ok: true,
      fileRef: { type: 'external', externalFileId },
      displayPath: absolutePath,
      fileName: path.basename(absolutePath)
    };
  }

  async function selectExternalFile() {
    try {
      const selectedPath = await selectFile();
      if (!selectedPath) return { ok: false, cancelled: true };
      return await registerExternalFile(selectedPath);
    } catch (error) {
      logger.error?.('[desktop:external-link:select-file]', error);
      return { ok: false, error: publicError(error, 'The selected file could not be linked.') };
    }
  }

  async function registerDroppedExternalFile(selectedPaths) {
    if (!Array.isArray(selectedPaths)) {
      return { ok: false, error: 'No local file was dropped.' };
    }
    for (const selectedPath of selectedPaths.slice(0, 64)) {
      if (typeof selectedPath !== 'string' || !selectedPath) continue;
      try {
        return await registerExternalFile(selectedPath);
      } catch (error) {
        if (['EACCES', 'ENOENT', 'ENOTDIR'].includes(error?.code)
          || error?.message === 'Select a local file or application.') continue;
        logger.error?.('[desktop:external-link:drop-file]', error);
        return { ok: false, error: publicError(error, 'The dropped file could not be linked.') };
      }
    }
    return { ok: false, error: 'Drop a local file or application.' };
  }

  async function resolveFile(fileRef) {
    if (fileRef?.type === 'external') {
      const externalFileId = typeof fileRef.externalFileId === 'string'
        ? fileRef.externalFileId
        : '';
      const settings = await loadSettings();
      const absolutePath = externalFileTargetForVault(
        settings, vaultId, externalFileId
      );
      if (!absolutePath) throw new Error('The linked file is unavailable.');
      const stat = await fsImpl.stat(absolutePath).catch(() => null);
      const selectablePackage = stat?.isDirectory()
        && path.extname(absolutePath).toLowerCase() === '.app';
      if (stat && (stat.isFile() || selectablePackage)) {
        return {
          normalized: { type: 'external', externalFileId },
          resolved: { absolutePath, resolution: 'exact-absolute' }
        };
      }

      // Opaque external links are normally absolute. If that exact target vanished
      // from inside a registered root, permit only one conservative relocation:
      // one exact full-filename match inside that same root. Ambiguous matches and
      // targets outside registered roots remain unavailable.
      const containingRoots = Object.values(folderRootsForVault(settings, vaultId))
        .filter((rootPath) => pathIsWithin(rootPath, absolutePath));
      const candidates = containingRoots.length
        ? await exactFilenameCandidates(fsImpl, containingRoots, path.basename(absolutePath))
        : [];
      if (candidates.length !== 1) {
        logger.warn?.('[desktop:external-link:resolve-missing]', {
          externalFileId,
          absolutePath,
          containingRoots,
          candidateCount: candidates.length
        });
        throw new Error('The linked file is unavailable.');
      }
      const relocatedPath = candidates[0];
      logger.info?.('[desktop:external-link:resolve-relocated]', {
        externalFileId,
        absolutePath,
        resolvedPath: relocatedPath,
        candidateCount: 1
      });
      return {
        normalized: { type: 'external', externalFileId },
        resolved: {
          absolutePath: relocatedPath,
          resolution: 'registered-root-exact-filename'
        }
      };
    }
    const normalized = normalizeResourceLocation(fileRef);
    const resolved = await resolveFileRef(normalized);
    return { normalized, resolved };
  }

  async function describeExternalFile(fileRef) {
    try {
      const { resolved } = await resolveFile(fileRef);
      return { ok: true, displayPath: resolved.absolutePath, fileName: path.basename(resolved.absolutePath) };
    } catch (error) {
      return { ok: false, error: publicError(error, 'The linked file is unavailable.') };
    }
  }

  async function openExternalTarget(target) {
    if (!target || typeof target !== 'object') return { ok: false, error: 'External target is invalid.' };
    try {
      if (target.targetKind === 'url') {
        const url = normalizeWebUrl(target.url);
        if (!url) return { ok: false, error: 'Only HTTP and HTTPS links can be opened.' };
        await openExternal(url);
        return { ok: true };
      }
      if (target.targetKind === 'file') {
        const { resolved } = await resolveFile(target.fileRef);
        const shellError = await openPath(resolved.absolutePath);
        if (shellError) return { ok: false, error: 'No desktop application could open this file.' };
        return { ok: true };
      }
      return { ok: false, error: 'External target is invalid.' };
    } catch (error) {
      logger.error?.('[desktop:external-link:open]', error);
      return { ok: false, error: publicError(error, 'The external target could not be opened.') };
    }
  }

  return {
    describeExternalFile,
    openExternalTarget,
    registerDroppedExternalFile,
    selectExternalFile
  };
}

module.exports = { createExternalLinkActions };
