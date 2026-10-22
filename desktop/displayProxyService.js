const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { normalizeResourceLocation } = require('../public/resourceLocations');
const imageResolution = require('../public/imageResolution');

function safeId(value) {
  return typeof value === 'string' && /^[a-z0-9_-]+$/i.test(value) ? value : null;
}

function proxyError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createDisplayProxyService({
  vaultId,
  cacheRoot,
  loadResource,
  resolveLocation,
  generateProxy,
  probeImage,
  fsImpl = fs,
  pathImpl = path,
  cryptoImpl = crypto
}) {
  if (!safeId(vaultId) || typeof cacheRoot !== 'string') {
    throw new Error('A stable vault identity and proxy cache root are required.');
  }
  if (![loadResource, resolveLocation, generateProxy, probeImage].every((value) => typeof value === 'function')) {
    throw new Error('Display proxy dependencies are incomplete.');
  }

  const generations = new Map();
  const sourceContexts = new Map();
  const validatedProxyKeys = new Set();

  function fingerprintFor(canonicalPath, stat) {
    const mtime = typeof stat.mtimeNs === 'bigint'
      ? stat.mtimeNs.toString()
      : String(Math.round(Number(stat.mtimeMs) * 1e6));
    return cryptoImpl.createHash('sha256')
      .update(JSON.stringify([vaultId, canonicalPath, String(stat.size), mtime]))
      .digest('hex');
  }

  function tierPaths(fingerprint, tier) {
    const directory = pathImpl.join(cacheRoot, fingerprint);
    return {
      directory,
      imagePath: pathImpl.join(directory, `${tier}.png`),
      metadataPath: pathImpl.join(directory, `${tier}.json`)
    };
  }

  async function fileStat(filePath, options) {
    try {
      return await fsImpl.stat(filePath, options);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function sourceContext(pageId, objectId) {
    if (!safeId(pageId) || !safeId(objectId)) {
      throw proxyError('A valid page and image object are required.', 'INVALID_RESOURCE_ID');
    }
    const resource = await loadResource(pageId, objectId);
    if (!resource || resource.type !== 'image' || resource.displayable === false) {
      throw proxyError('Display image not found.', 'RESOURCE_NOT_FOUND');
    }
    const location = normalizeResourceLocation(resource);
    const resolved = await resolveLocation(location, {
      pageId,
      resourceId: objectId,
      resource
    });
    const relocation = resolved.relocated ? {
      location: resolved.location,
      previousLocation: resolved.previousLocation,
      updatedResourceIds: resolved.updatedResourceIds
    } : null;
    let canonicalPath;
    let stat;
    try {
      canonicalPath = await fsImpl.realpath(resolved.absolutePath);
      stat = await fsImpl.stat(canonicalPath, { bigint: true });
    } catch (error) {
      if (error.code === 'ENOENT') throw proxyError('Original image is unavailable.', 'SOURCE_MISSING');
      throw error;
    }
    if (!stat.isFile()) throw proxyError('Original image is unavailable.', 'SOURCE_MISSING');
    const fingerprint = fingerprintFor(canonicalPath, stat);
    const remembered = sourceContexts.get(fingerprint);
    if (remembered) return { ...remembered, resource, pageId, objectId, relocation };

    let width = Number(resource.naturalWidth);
    let height = Number(resource.naturalHeight);
    if (!(width > 0 && height > 0)) {
      const dimensions = await probeImage(canonicalPath);
      width = Number(dimensions?.width);
      height = Number(dimensions?.height);
    }
    if (!(width > 0 && height > 0)) {
      throw proxyError('Original image dimensions could not be read.', 'INVALID_IMAGE');
    }
    const context = {
      fingerprint,
      canonicalPath,
      sourceSize: Number(stat.size),
      sourceMtimeNs: typeof stat.mtimeNs === 'bigint'
        ? stat.mtimeNs.toString()
        : String(Math.round(Number(stat.mtimeMs) * 1e6)),
      width,
      height,
      relocation
    };
    sourceContexts.set(fingerprint, context);
    return { ...context, resource, pageId, objectId };
  }

  async function cachedTier(context, tier) {
    const paths = tierPaths(context.fingerprint, tier);
    const key = `${context.fingerprint}:${tier}`;
    try {
      const [rawMetadata, imageStat] = await Promise.all([
        fsImpl.readFile(paths.metadataPath, 'utf8'),
        fileStat(paths.imagePath)
      ]);
      const metadata = JSON.parse(rawMetadata);
      if (!imageStat?.isFile() || imageStat.size <= 0
        || metadata.fingerprint !== context.fingerprint
        || Number(metadata.tier) !== tier
        || !(Number(metadata.width) > 0 && Number(metadata.height) > 0)) return null;
      if (!validatedProxyKeys.has(key)) {
        const dimensions = await probeImage(paths.imagePath);
        if (Number(dimensions?.width) !== Number(metadata.width)
          || Number(dimensions?.height) !== Number(metadata.height)) return null;
        validatedProxyKeys.add(key);
      }
      return {
        tier,
        width: Number(metadata.width),
        height: Number(metadata.height),
        size: Number(imageStat.size),
        displayPath: `/api/display-proxies/${context.fingerprint}/${tier}`
      };
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async function ensureTier(context, tier) {
    const cached = await cachedTier(context, tier);
    if (cached) return cached;
    const key = `${context.fingerprint}:${tier}`;
    if (generations.has(key)) return generations.get(key);
    const generation = (async () => {
      const paths = tierPaths(context.fingerprint, tier);
      await fsImpl.mkdir(paths.directory, { recursive: true });
      const nonce = `${process.pid}-${Date.now()}-${cryptoImpl.randomBytes(5).toString('hex')}`;
      const temporaryImage = `${paths.imagePath}.${nonce}.tmp.png`;
      const temporaryMetadata = `${paths.metadataPath}.${nonce}.tmp`;
      try {
        const dimensions = await generateProxy({
          sourcePath: context.canonicalPath,
          destinationPath: temporaryImage,
          maxLongEdge: tier
        });
        const width = Number(dimensions?.width);
        const height = Number(dimensions?.height);
        if (!(width > 0 && height > 0)
          || Math.max(width, height) > tier
          || Math.max(width, height) >= Math.max(context.width, context.height)) {
          throw proxyError('Generated display proxy is invalid.', 'INVALID_PROXY');
        }
        const generatedStat = await fileStat(temporaryImage);
        if (!generatedStat?.isFile() || generatedStat.size <= 0) {
          throw proxyError('Generated display proxy is empty.', 'INVALID_PROXY');
        }
        await fsImpl.writeFile(temporaryMetadata, JSON.stringify({
          version: 1,
          fingerprint: context.fingerprint,
          tier,
          width,
          height
        }));
        await fsImpl.rename(temporaryImage, paths.imagePath);
        await fsImpl.rename(temporaryMetadata, paths.metadataPath);
        validatedProxyKeys.add(key);
        return {
          tier,
          width,
          height,
          size: Number(generatedStat.size),
          displayPath: `/api/display-proxies/${context.fingerprint}/${tier}`
        };
      } finally {
        await Promise.allSettled([
          fsImpl.rm(temporaryImage, { force: true }),
          fsImpl.rm(temporaryMetadata, { force: true })
        ]);
      }
    })().finally(() => generations.delete(key));
    generations.set(key, generation);
    return generation;
  }

  function originalVariant(context) {
    return {
      tier: imageResolution.ORIGINAL_TIER,
      width: context.width,
      height: context.height,
      size: context.sourceSize,
      displayPath: `/api/pages/${encodeURIComponent(context.pageId)}`
        + `/resources/${encodeURIComponent(context.objectId)}/content`
    };
  }

  function notifySafely(onReady, context, variant) {
    if (typeof onReady !== 'function') return;
    onReady({
      pageId: context.pageId,
      objectId: context.objectId,
      fingerprint: context.fingerprint,
      requestedTier: variant.tier,
      variant
    });
  }

  function scheduleUpgrade(context, firstTier, requestedTier, onReady) {
    const numericRequested = Number(requestedTier);
    const afterFirst = firstTier
      ? ensureTier(context, firstTier).then((variant) => {
        notifySafely(onReady, context, variant);
        return variant;
      }).catch(() => null)
      : Promise.resolve(null);
    afterFirst.then(async (firstVariant) => {
      if (requestedTier === imageResolution.ORIGINAL_TIER) {
        notifySafely(onReady, context, originalVariant(context));
        return;
      }
      if (numericRequested === firstVariant?.tier) return;
      const variant = await ensureTier(context, numericRequested);
      notifySafely(onReady, context, variant);
    }).catch(() => {
      // The request response and renderer fallback remain valid when generation fails.
    });
  }

  async function requestVariant({ pageId, objectId, requiredLongEdge }, onReady) {
    const context = await sourceContext(pageId, objectId);
    const requestedTier = imageResolution.chooseTier(
      context.width,
      context.height,
      Number(requiredLongEdge)
    );
    const numericTiers = imageResolution.availableTiers(context.width, context.height)
      .filter((tier) => typeof tier === 'number');

    if (!numericTiers.length) {
      return {
        ok: true,
        pageId,
        objectId,
        fingerprint: context.fingerprint,
        requestedTier,
        selectedTier: imageResolution.ORIGINAL_TIER,
        variant: originalVariant(context),
        relocation: context.relocation,
        generationPending: false
      };
    }

    const cached = (await Promise.all(numericTiers.map((tier) => cachedTier(context, tier))))
      .filter(Boolean)
      .sort((a, b) => imageResolution.tierRank(a.tier) - imageResolution.tierRank(b.tier));
    const requestedRank = imageResolution.tierRank(requestedTier);
    const selected = cached.find((variant) => imageResolution.tierRank(variant.tier) >= requestedRank)
      || cached[cached.length - 1]
      || null;
    const selectedRank = imageResolution.tierRank(selected?.tier);
    const needsUpgrade = !selected || selectedRank < requestedRank;
    if (needsUpgrade) {
      scheduleUpgrade(
        context,
        selected ? null : numericTiers[0],
        requestedTier,
        onReady
      );
    }
    return {
      ok: true,
      pageId,
      objectId,
      fingerprint: context.fingerprint,
      requestedTier,
      selectedTier: selected?.tier || null,
      variant: selected,
      relocation: context.relocation,
      generationPending: needsUpgrade
    };
  }

  async function prepareContent(fingerprint, tierValue) {
    if (!/^[a-f0-9]{64}$/.test(fingerprint || '')) {
      throw proxyError('Display proxy not found.', 'PROXY_NOT_FOUND');
    }
    const tier = Number(tierValue);
    if (!imageResolution.PROXY_TIERS.includes(tier)) {
      throw proxyError('Display proxy not found.', 'PROXY_NOT_FOUND');
    }
    const context = sourceContexts.get(fingerprint);
    if (!context) throw proxyError('Display proxy not found.', 'PROXY_NOT_FOUND');
    let stat;
    try {
      stat = await fsImpl.stat(context.canonicalPath, { bigint: true });
    } catch (error) {
      if (error.code === 'ENOENT') throw proxyError('Original image is unavailable.', 'SOURCE_MISSING');
      throw error;
    }
    if (!stat.isFile() || fingerprintFor(context.canonicalPath, stat) !== fingerprint) {
      throw proxyError('Original image changed.', 'SOURCE_CHANGED');
    }
    const variant = await cachedTier(context, tier);
    if (!variant) throw proxyError('Display proxy not found.', 'PROXY_NOT_FOUND');
    return {
      absolutePath: tierPaths(fingerprint, tier).imagePath,
      size: variant.size,
      mimeType: 'image/png'
    };
  }

  return {
    pendingGenerationCount: () => generations.size,
    prepareContent,
    requestVariant
  };
}

module.exports = { createDisplayProxyService };
