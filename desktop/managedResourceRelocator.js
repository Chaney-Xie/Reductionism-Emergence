const fs = require('fs/promises');
const path = require('path');
const { isPathInside, normalizeResourceLocationInput } = require('./vaultPaths');

const DEFAULT_INDEX_TTL_MS = 10_000;

function sameFileIdentity(left, right) {
  return left && right
    && Number.isFinite(left.dev)
    && Number.isFinite(left.ino)
    && left.dev === right.dev
    && left.ino === right.ino;
}

function statIdentity(stat) {
  return stat ? { dev: Number(stat.dev), ino: Number(stat.ino) } : null;
}

function resourceKey(context) {
  return typeof context?.pageId === 'string' && typeof context?.resourceId === 'string'
    ? `${context.pageId}:${context.resourceId}`
    : null;
}

async function indexManagedRoot(rootPath, { fsImpl = fs, pathImpl = path } = {}) {
  const realRoot = await fsImpl.realpath(pathImpl.resolve(rootPath));
  const rootStat = await fsImpl.stat(realRoot);
  if (!rootStat.isDirectory()) throw new Error('The managed resource root is unavailable.');
  const filesByName = new Map();
  const visitedDirectories = new Set([realRoot]);
  const pendingDirectories = [realRoot];

  while (pendingDirectories.length) {
    const directory = pendingDirectories.pop();
    let entries;
    try {
      entries = await fsImpl.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) continue;
      throw error;
    }
    for (const entry of entries) {
      const candidate = pathImpl.join(directory, entry.name);
      let realCandidate;
      let stat;
      try {
        realCandidate = await fsImpl.realpath(candidate);
        if (!isPathInside(realRoot, realCandidate)) continue;
        stat = await fsImpl.stat(realCandidate);
      } catch (error) {
        if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) continue;
        throw error;
      }
      if (stat.isDirectory()) {
        if (!visitedDirectories.has(realCandidate)) {
          visitedDirectories.add(realCandidate);
          pendingDirectories.push(realCandidate);
        }
        continue;
      }
      if (!stat.isFile()) continue;
      const record = {
        absolutePath: realCandidate,
        relativePath: pathImpl.relative(realRoot, realCandidate).split(pathImpl.sep).join('/'),
        size: Number(stat.size),
        ...statIdentity(stat)
      };
      const named = filesByName.get(entry.name) || [];
      named.push(record);
      filesByName.set(entry.name, named);
    }
  }

  return { realRoot, filesByName };
}

function createManagedResourceRelocator({
  resolveDirect,
  managedRoot,
  persistRelocation,
  fsImpl = fs,
  pathImpl = path,
  indexTtlMs = DEFAULT_INDEX_TTL_MS,
  now = () => Date.now()
}) {
  if (![resolveDirect, managedRoot, persistRelocation].every((value) => typeof value === 'function')) {
    throw new TypeError('Managed resource relocation dependencies are incomplete.');
  }
  const rootIndexes = new Map();
  const rememberedIdentities = new Map();
  const negativeLookups = new Map();

  async function cachedRootIndex(rootPath, { force = false } = {}) {
    const cacheKey = pathImpl.resolve(rootPath);
    const cached = rootIndexes.get(cacheKey);
    if (!force && cached && now() - cached.createdAt < indexTtlMs) return cached.promise;
    const promise = indexManagedRoot(rootPath, { fsImpl, pathImpl });
    rootIndexes.set(cacheKey, { createdAt: now(), promise });
    try {
      return await promise;
    } catch (error) {
      if (rootIndexes.get(cacheKey)?.promise === promise) rootIndexes.delete(cacheKey);
      throw error;
    }
  }

  async function rememberResolved(context, resolved) {
    const key = resourceKey(context);
    if (!key) return;
    try {
      const stat = await fsImpl.stat(resolved.absolutePath);
      rememberedIdentities.set(key, statIdentity(stat));
    } catch {
      // Resolution already succeeded; identity memory is only an optional live-move aid.
    }
  }

  async function resolve(locationInput, context = {}) {
    const location = normalizeResourceLocationInput(locationInput);
    try {
      const resolved = await resolveDirect(location);
      await rememberResolved(context, resolved);
      return { ...resolved, location };
    } catch (originalError) {
      if (originalError?.code !== 'NOT_FOUND') throw originalError;
      const key = resourceKey(context);
      if (!key || !context.resource) throw originalError;

      const ownership = await managedRoot(location);
      if (!ownership?.rootPath || typeof ownership.toLocation !== 'function') throw originalError;
      const filename = pathImpl.posix.basename(location.relativePath);
      const negativeKey = [pathImpl.resolve(ownership.rootPath), filename].join(':');
      if (now() - (negativeLookups.get(negativeKey) || 0) < indexTtlMs) throw originalError;

      const rootIndex = await cachedRootIndex(ownership.rootPath, { force: true });
      let candidates = rootIndex.filesByName.get(filename) || [];
      const rememberedIdentity = rememberedIdentities.get(key);
      if (rememberedIdentity) {
        const identityMatches = candidates.filter((candidate) => (
          sameFileIdentity(rememberedIdentity, candidate)
        ));
        if (identityMatches.length) candidates = identityMatches;
      }
      if (candidates.length !== 1) {
        negativeLookups.set(negativeKey, now());
        throw originalError;
      }

      const candidate = candidates[0];
      const nextLocation = normalizeResourceLocationInput(
        ownership.toLocation(candidate.relativePath)
      );
      const verified = await resolveDirect(nextLocation);
      const persisted = await persistRelocation({
        pageId: context.pageId,
        resourceId: context.resourceId,
        previousLocation: location,
        nextLocation
      });
      negativeLookups.delete(negativeKey);
      rememberedIdentities.set(key, { dev: candidate.dev, ino: candidate.ino });
      return {
        ...verified,
        location: persisted?.location || nextLocation,
        relocated: true,
        previousLocation: location,
        updatedResourceIds: Array.isArray(persisted?.updatedResourceIds)
          ? persisted.updatedResourceIds
          : [context.resourceId]
      };
    }
  }

  return { resolve };
}

module.exports = {
  DEFAULT_INDEX_TTL_MS,
  createManagedResourceRelocator,
  indexManagedRoot,
  sameFileIdentity
};
