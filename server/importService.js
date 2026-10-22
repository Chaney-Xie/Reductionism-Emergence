const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const {
  normalizeResourceLocation,
  vaultResourceLocation
} = require('../public/resourceLocations');

// Import parsing, asset collision handling, image sizing, and duplicate detection
// share one transaction boundary but remain independent from Express routes.
function createImportService({
  imageAssetsDir,
  resourceAssetsDir,
  localAssetFilePath,
  writeFile = fs.writeFile.bind(fs)
}) {
  const IMAGE_ASSETS_DIR = imageAssetsDir;
  const RESOURCE_ASSETS_DIR = resourceAssetsDir;

  function safeAssetName(filename = 'imported-file') {
    const parsed = path.parse(filename);
    const base = parsed.name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'imported-file';
    const ext = parsed.ext.toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 16);
    return `${base}${ext}`;
  }

  function contentHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  async function storedAssetPath(directory, publicPrefix, originalName, buffer) {
    await fs.mkdir(directory, { recursive: true });
    const safeName = safeAssetName(originalName);
    const parsed = path.parse(safeName);
    const incomingHash = contentHash(buffer);

    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const filename = attempt === 0
        ? safeName
        : `${parsed.name}_${attempt}${parsed.ext}`;
      const filePath = path.join(directory, filename);

      try {
        const existing = await fs.readFile(filePath);
        if (contentHash(existing) === incomingHash) {
          return { src: `${publicPrefix}/${filename}`, hash: incomingHash };
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await writeFile(filePath, buffer);
        return { src: `${publicPrefix}/${filename}`, hash: incomingHash };
      }
    }

    throw new Error('Could not store uploaded file safely.');
  }

  function detectImportedFileType(file) {
    const extension = path.extname(file.originalName || '').toLowerCase().slice(1);
    const mimeType = (file.mimeType || '').toLowerCase();
    const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
    const imageMimes = new Set([
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/svg+xml'
    ]);

    if (imageExtensions.has(extension) || imageMimes.has(mimeType)) {
      return {
        kind: 'image',
        resourceType: extension || mimeType.split('/').pop() || 'image',
        displayable: true,
        assetFolder: 'images'
      };
    }

    return {
      kind: 'file',
      resourceType: extension || mimeType || 'unknown',
      displayable: false,
      assetFolder: 'resources'
    };
  }

  function pngDimensions(buffer) {
    const pngSignature = '89504e470d0a1a0a';
    if (buffer.length < 24 || buffer.slice(0, 8).toString('hex') !== pngSignature) return null;
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    };
  }

  function gifDimensions(buffer) {
    const header = buffer.slice(0, 6).toString('ascii');
    if (buffer.length < 10 || (header !== 'GIF87a' && header !== 'GIF89a')) return null;
    return {
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8)
    };
  }

  function jpegDimensions(buffer) {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) return null;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      const isSof = (marker >= 0xc0 && marker <= 0xc3)
        || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb)
        || (marker >= 0xcd && marker <= 0xcf);

      if (isSof && offset + 8 < buffer.length) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7)
        };
      }

      offset += 2 + length;
    }

    return null;
  }

  function webpDimensions(buffer) {
    if (buffer.length < 30
      || buffer.slice(0, 4).toString('ascii') !== 'RIFF'
      || buffer.slice(8, 12).toString('ascii') !== 'WEBP') return null;

    const chunkType = buffer.slice(12, 16).toString('ascii');
    if (chunkType === 'VP8X' && buffer.length >= 30) {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3)
      };
    }

    if (chunkType === 'VP8 ' && buffer.length >= 30) {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff
      };
    }

    if (chunkType === 'VP8L' && buffer.length >= 25) {
      const b0 = buffer[21];
      const b1 = buffer[22];
      const b2 = buffer[23];
      const b3 = buffer[24];
      return {
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
      };
    }

    return null;
  }

  function svgDimensions(buffer) {
    const text = buffer.toString('utf8', 0, Math.min(buffer.length, 4096));
    const svgTag = text.match(/<svg\b[^>]*>/i)?.[0];
    if (!svgTag) return null;

    const numberAttr = (name) => {
      const value = svgTag.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'))?.[1];
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };
    const width = numberAttr('width');
    const height = numberAttr('height');
    if (width && height) return { width, height };

    const viewBox = svgTag.match(/viewBox=["']([^"']+)["']/i)?.[1]
      ?.trim()
      .split(/[\s,]+/)
      .map(Number);
    if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) {
      return { width: Math.max(1, viewBox[2]), height: Math.max(1, viewBox[3]) };
    }

    return null;
  }

  function imageDimensions(buffer, resourceType) {
    const type = resourceType.toLowerCase();
    const dimensions = type === 'png' ? pngDimensions(buffer)
      : type === 'jpg' || type === 'jpeg' ? jpegDimensions(buffer)
        : type === 'gif' ? gifDimensions(buffer)
          : type === 'webp' ? webpDimensions(buffer)
            : type === 'svg' ? svgDimensions(buffer)
              : null;

    return dimensions || { width: 720, height: 509 };
  }

  function calculateImageDisplaySize(naturalWidth, naturalHeight) {
    const maxDisplayWidth = 720;
    const width = Number(naturalWidth);
    const height = Number(naturalHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return { width: maxDisplayWidth, height: 509 };
    }

    if (width <= maxDisplayWidth) {
      return {
        width: Math.round(width * 100) / 100,
        height: Math.round(height * 100) / 100
      };
    }

    const scale = maxDisplayWidth / width;
    return {
      width: maxDisplayWidth,
      height: Math.round(height * scale * 100) / 100
    };
  }

  function positiveNumber(value) {
    return Number.isFinite(value) && value > 0;
  }

  function importedImageObject(object) {
    return object
      && object.type === 'image'
      && object.src
      && object.displayable !== false
      && (object.originalName || object.contentHash || object.cacheBuster);
  }

  function resourceTypeFromSrc(src = '') {
    return path.extname(publicAssetBasename(src)).toLowerCase().slice(1) || 'image';
  }

  async function naturalDimensionsForImportedObject(object) {
    if (positiveNumber(object.naturalWidth) && positiveNumber(object.naturalHeight)) {
      return {
        width: object.naturalWidth,
        height: object.naturalHeight
      };
    }

    const filePath = localAssetFilePath(object.src);
    if (filePath) {
      try {
        const buffer = await fs.readFile(filePath);
        return imageDimensions(buffer, object.resourceType || resourceTypeFromSrc(object.src));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }

    if (positiveNumber(object.width) && positiveNumber(object.height)) {
      return {
        width: object.width,
        height: object.height
      };
    }

    return null;
  }

  function hasSuspiciousImportedDisplaySize(object, naturalDimensions) {
    if (!positiveNumber(object.width) || !positiveNumber(object.height)) return true;
    if (object.width > 2000) return true;
    return naturalDimensions.width > 720 && Math.abs(object.width - naturalDimensions.width) < 0.01;
  }

  async function repairImportedImageDisplaySizes(page) {
    let changed = false;

    for (const object of page.objects || []) {
      if (!importedImageObject(object)) continue;

      const naturalDimensions = await naturalDimensionsForImportedObject(object);
      if (!naturalDimensions) continue;

      if (object.naturalWidth !== naturalDimensions.width) {
        object.naturalWidth = naturalDimensions.width;
        changed = true;
      }
      if (object.naturalHeight !== naturalDimensions.height) {
        object.naturalHeight = naturalDimensions.height;
        changed = true;
      }

      if (hasSuspiciousImportedDisplaySize(object, naturalDimensions)) {
        const displaySize = calculateImageDisplaySize(
          naturalDimensions.width,
          naturalDimensions.height
        );
        object.width = displaySize.width;
        object.height = displaySize.height;
        changed = true;
      }
    }

    return changed;
  }

  function idPageSuffix(pageId) {
    return pageId.replace(/^page_/, '').replace(/[^a-z0-9_-]+/gi, '_');
  }

  function nextItemId(prefix, pageId, existingItems) {
    const suffix = idPageSuffix(pageId);
    const idPrefix = `${prefix}_${suffix}_`;
    const ids = new Set(existingItems.map((item) => item.id));
    let number = 1;

    while (ids.has(`${idPrefix}${String(number).padStart(3, '0')}`)) number += 1;
    return `${idPrefix}${String(number).padStart(3, '0')}`;
  }

  function publicAssetBasename(src = '') {
    const cleanSrc = String(src).split('?')[0].split('#')[0];
    const parts = cleanSrc.split('/').filter(Boolean);
    return parts.length ? parts.at(-1) : '';
  }

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function mojibakeMarkerCount(value = '') {
    return (String(value).match(/[ÃÂæçåäéè]/g) || []).length;
  }

  function cjkCharacterCount(value = '') {
    return (String(value).match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  }

  function cleanImportedFilename(name = '') {
    const cleaned = String(name || 'imported-file')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim() || 'imported-file';
    return typeof cleaned.normalize === 'function' ? cleaned.normalize('NFC') : cleaned;
  }

  function betterImportedFilename(candidate, original) {
    if (!candidate || candidate === original || candidate.includes('\uFFFD')) return false;
    if (cjkCharacterCount(candidate) > cjkCharacterCount(original)) return true;
    return mojibakeMarkerCount(candidate) < mojibakeMarkerCount(original);
  }

  function normalizeImportedFilename(name = 'imported-file') {
    let normalized = cleanImportedFilename(name);

    if (/%[0-9a-f]{2}/i.test(normalized)) {
      const decoded = cleanImportedFilename(safeDecodeURIComponent(normalized));
      if (betterImportedFilename(decoded, normalized)
        || (!decoded.includes('%') && decoded !== normalized)) normalized = decoded;
    }

    if (mojibakeMarkerCount(normalized)) {
      const repaired = cleanImportedFilename(Buffer.from(normalized, 'latin1').toString('utf8'));
      if (betterImportedFilename(repaired, normalized)) normalized = repaired;
    }

    return normalized;
  }

  function normalizedImportName(name = '') {
    return normalizeImportedFilename(name).toLowerCase();
  }

  function importedItemNames(item) {
    return [
      item?.originalName,
      publicAssetBasename(item?.src)
    ].filter(Boolean).map(normalizedImportName);
  }

  function itemMatchesImportedFilename(item, filename) {
    const normalized = normalizedImportName(filename);
    return Boolean(normalized && importedItemNames(item).includes(normalized));
  }

  function duplicateImportSummary(item, kind) {
    return {
      id: item.id,
      kind,
      originalName: item.originalName || null,
      src: item.src || null
    };
  }

  function findFilenameDuplicate(page, filename) {
    const objects = page.objects || [];
    const resources = page.maintenanceResources || [];

    for (const object of objects) {
      if (itemMatchesImportedFilename(object, filename)) {
        return duplicateImportSummary(object, 'object');
      }
    }

    for (const resource of resources) {
      if (itemMatchesImportedFilename(resource, filename)) {
        return duplicateImportSummary(resource, 'resource');
      }
    }

    return null;
  }

  function hasBlocksForObject(page, objectId) {
    return (page.blocks || []).some((block) => block.objectId === objectId);
  }

  function cleanupDuplicateImportedItems(page) {
    const seen = new Map();
    const warnings = [];

    const rememberOrDuplicate = (item, kind) => {
      const names = importedItemNames(item);
      for (const name of names) {
        if (seen.has(name)) {
          return { name, first: seen.get(name), duplicate: { item, kind } };
        }
      }

      for (const name of names) seen.set(name, { item, kind });
      return null;
    };

    const removableObjectIds = new Set();
    const removableResourceIds = new Set();

    for (const object of page.objects || []) {
      const duplicate = rememberOrDuplicate(object, 'object');
      if (!duplicate) continue;

      if (hasBlocksForObject(page, object.id)) {
        warnings.push(`Duplicate import kept because blocks reference object ${object.id}.`);
      } else {
        removableObjectIds.add(object.id);
        warnings.push(`Removed duplicate imported object ${object.id}.`);
      }
    }

    for (const resource of page.maintenanceResources || []) {
      const duplicate = rememberOrDuplicate(resource, 'resource');
      if (!duplicate) continue;

      removableResourceIds.add(resource.id);
      warnings.push(`Removed duplicate imported resource ${resource.id}.`);
    }

    if (removableObjectIds.size) {
      page.objects = (page.objects || []).filter((object) => !removableObjectIds.has(object.id));
    }

    if (removableResourceIds.size) {
      page.maintenanceResources = (page.maintenanceResources || [])
        .filter((resource) => !removableResourceIds.has(resource.id));
    }

    for (const warning of warnings) console.warn(warning);
    return warnings;
  }

  function matchingImportedItem(item, file, hash, src = null) {
    return (src && item.src === src)
      || (
        item.originalName === file.originalName
        && item.size === file.size
        && item.contentHash === hash
      );
  }

  function findExistingImport(page, file, hash, typeInfo, src = null) {
    if (typeInfo.displayable) {
      return page.objects.find((object) => matchingImportedItem(object, file, hash, src));
    }

    return page.maintenanceResources.find((resource) => matchingImportedItem(resource, file, hash, src));
  }

  function createObjectFromImportedFile(page, file, typeInfo, stored, visible, now) {
    const naturalDimensions = imageDimensions(file.buffer, typeInfo.resourceType);
    const displaySize = calculateImageDisplaySize(
      naturalDimensions.width,
      naturalDimensions.height
    );
    const x = page.objects
      .filter((object) => object.visible !== false && Number.isFinite(object.x) && Number.isFinite(object.width))
      .reduce((maxX, object) => Math.max(maxX, object.x + object.width), 0);

    return {
      id: nextItemId('object', page.id, page.objects),
      type: 'image',
      src: stored.src,
      location: vaultResourceLocation(stored.src),
      originalName: file.originalName,
      mimeType: file.mimeType,
      displayable: true,
      visible,
      x,
      y: 0,
      naturalWidth: naturalDimensions.width,
      naturalHeight: naturalDimensions.height,
      width: displaySize.width,
      height: displaySize.height,
      size: file.size,
      contentHash: stored.hash,
      createdAt: now
    };
  }

  function createMaintenanceResourceFromImportedFile(page, file, typeInfo, stored, now) {
    return {
      id: nextItemId('resource', page.id, page.maintenanceResources),
      type: 'file',
      resourceType: typeInfo.resourceType,
      src: stored.src,
      location: vaultResourceLocation(stored.src),
      originalName: file.originalName,
      mimeType: file.mimeType,
      displayable: false,
      size: file.size,
      contentHash: stored.hash,
      createdAt: now
    };
  }

  function importConflictError(message, duplicate = null) {
    const error = new Error(message);
    error.status = 409;
    error.duplicate = duplicate;
    return error;
  }

  function updateImportedObject(existingObject, file, typeInfo, stored, importTarget, now) {
    const naturalDimensions = imageDimensions(file.buffer, typeInfo.resourceType);
    const displaySize = calculateImageDisplaySize(
      naturalDimensions.width,
      naturalDimensions.height
    );
    existingObject.type = 'image';
    existingObject.src = stored.src;
    existingObject.location = vaultResourceLocation(stored.src);
    existingObject.originalName = file.originalName;
    existingObject.mimeType = file.mimeType;
    existingObject.displayable = true;
    if (importTarget === 'canvas') existingObject.visible = true;
    existingObject.x = Number.isFinite(existingObject.x) ? existingObject.x : 0;
    existingObject.y = Number.isFinite(existingObject.y) ? existingObject.y : 0;
    existingObject.naturalWidth = naturalDimensions.width;
    existingObject.naturalHeight = naturalDimensions.height;
    if (!positiveNumber(existingObject.width)
      || !positiveNumber(existingObject.height)
      || hasSuspiciousImportedDisplaySize(existingObject, naturalDimensions)) {
      existingObject.width = displaySize.width;
      existingObject.height = displaySize.height;
    }
    existingObject.size = file.size;
    existingObject.contentHash = stored.hash;
    existingObject.updatedAt = now;
    existingObject.cacheBuster = now;
    return existingObject;
  }

  function updateImportedResource(existingResource, file, typeInfo, stored, now) {
    existingResource.type = 'file';
    existingResource.resourceType = typeInfo.resourceType;
    existingResource.src = stored.src;
    existingResource.location = vaultResourceLocation(stored.src);
    existingResource.originalName = file.originalName;
    existingResource.mimeType = file.mimeType;
    existingResource.displayable = false;
    existingResource.size = file.size;
    existingResource.contentHash = stored.hash;
    existingResource.updatedAt = now;
    existingResource.cacheBuster = now;
    return existingResource;
  }

  function findReplacementTarget(page, replaceItemId, replaceItemKind) {
    if (!replaceItemId) return null;
    const kind = replaceItemKind === 'resource' ? 'resource' : 'object';
    const items = kind === 'object' ? page.objects || [] : page.maintenanceResources || [];
    const item = items.find((candidate) => candidate.id === replaceItemId);
    return item ? { item, kind } : null;
  }

  async function importFileToPage(page, file, importTarget, now, options = {}) {
    const typeInfo = detectImportedFileType(file);
    const hash = contentHash(file.buffer);
    const replacement = findReplacementTarget(page, options.replaceItemId, options.replaceItemKind);

    if (replacement) {
      if (typeInfo.displayable && replacement.kind !== 'object') {
        throw importConflictError(`A file named ${file.originalName} already exists as a resource. Replacement was cancelled.`);
      }
      if (!typeInfo.displayable && replacement.kind !== 'resource') {
        throw importConflictError(`A file named ${file.originalName} already exists as an image object. Replacement was cancelled.`);
      }

      const stored = typeInfo.assetFolder === 'images'
        ? await storedAssetPath(IMAGE_ASSETS_DIR, 'assets/images', file.originalName, file.buffer)
        : await storedAssetPath(RESOURCE_ASSETS_DIR, 'assets/resources', file.originalName, file.buffer);
      const item = replacement.kind === 'object'
        ? updateImportedObject(replacement.item, file, typeInfo, stored, importTarget, now)
        : updateImportedResource(replacement.item, file, typeInfo, stored, now);
      return { item, created: false, reused: false, replaced: true };
    }

    const filenameDuplicate = findFilenameDuplicate(page, file.originalName);
    if (filenameDuplicate) {
      throw importConflictError(
        `A file named ${file.originalName} already exists on this page.`,
        filenameDuplicate
      );
    }

    const existingBeforeStore = findExistingImport(page, file, hash, typeInfo);
    if (existingBeforeStore) {
      if (typeInfo.displayable && importTarget === 'canvas') existingBeforeStore.visible = true;
      return { item: existingBeforeStore, created: false, reused: true };
    }

    const stored = typeInfo.assetFolder === 'images'
      ? await storedAssetPath(IMAGE_ASSETS_DIR, 'assets/images', file.originalName, file.buffer)
      : await storedAssetPath(RESOURCE_ASSETS_DIR, 'assets/resources', file.originalName, file.buffer);
    const existingAfterStore = findExistingImport(page, file, stored.hash, typeInfo, stored.src);
    if (existingAfterStore) {
      if (typeInfo.displayable && importTarget === 'canvas') existingAfterStore.visible = true;
      return { item: existingAfterStore, created: false, reused: true };
    }

    if (typeInfo.displayable) {
      const object = createObjectFromImportedFile(
        page,
        file,
        typeInfo,
        stored,
        importTarget === 'canvas',
        now
      );
      page.objects.push(object);
      return { item: object, created: true, reused: false };
    }

    const resource = createMaintenanceResourceFromImportedFile(page, file, typeInfo, stored, now);
    page.maintenanceResources.push(resource);
    return { item: resource, created: true, reused: false };
  }

  function linkOriginalFilesToPage(page, files, now, {
    placementCenter = null,
    placementId = 'canvas'
  } = {}) {
    const prepared = files.map((file) => {
      const location = normalizeResourceLocation(file.location || file);
      if (!['vault', 'workspace', 'folder'].includes(location.type)) {
        throw importConflictError('Files must use a managed resource location.');
      }
      const originalName = normalizeImportedFilename(path.posix.basename(location.relativePath));
      const typeInfo = detectImportedFileType({
        originalName,
        mimeType: file.mimeType || 'application/octet-stream'
      });
      return { ...file, location, originalName, typeInfo };
    });

    const incomingNames = new Set();
    for (const file of prepared) {
      const compareName = normalizedImportName(file.originalName);
      if (incomingNames.has(compareName) || findFilenameDuplicate(page, file.originalName)) {
        throw importConflictError(`A file named ${file.originalName} already exists on this page.`);
      }
      incomingNames.add(compareName);
    }

    const linked = [];
    const incomingVisualCount = prepared.filter((file) => file.typeInfo.displayable).length;
    const usesMarkdownDocumentPlacement = placementId === 'markdown-document';
    const stackVisualObjects = Boolean(placementCenter)
      && (usesMarkdownDocumentPlacement
        || incomingVisualCount > 1
        || (page.objects || []).some((item) => item.displayable !== false));
    for (const file of prepared) {
      if (file.typeInfo.displayable) {
        const naturalDimensions = imageDimensions(file.buffer || Buffer.alloc(0), file.typeInfo.resourceType);
        const displaySize = calculateImageDisplaySize(
          naturalDimensions.width,
          naturalDimensions.height
        );
        const object = {
          id: nextItemId('object', page.id, page.objects),
          type: 'image',
          location: file.location,
          originalName: file.originalName,
          fileName: file.originalName,
          mimeType: file.mimeType || 'application/octet-stream',
          resourceType: file.typeInfo.resourceType,
          displayable: true,
          visible: true,
          x: stackVisualObjects
            ? placementCenter.x - displaySize.width / 2
            : page.objects
              .filter((item) => item.visible !== false && Number.isFinite(item.x) && Number.isFinite(item.width))
              .reduce((maxX, item) => Math.max(maxX, item.x + item.width), 0),
          y: stackVisualObjects
            ? (usesMarkdownDocumentPlacement
              ? Math.max(0, placementCenter.y - displaySize.height / 2)
              : placementCenter.y - displaySize.height / 2)
            : 0,
          naturalWidth: naturalDimensions.width,
          naturalHeight: naturalDimensions.height,
          width: displaySize.width,
          height: displaySize.height,
          size: file.size,
          createdAt: now
        };
        page.objects.push(object);
        linked.push({ item: object, created: true });
      } else {
        const resource = {
          id: nextItemId('resource', page.id, page.maintenanceResources),
          type: 'file',
          resourceType: file.typeInfo.resourceType,
          location: file.location,
          originalName: file.originalName,
          fileName: file.originalName,
          mimeType: file.mimeType || 'application/octet-stream',
          displayable: false,
          size: file.size,
          createdAt: now
        };
        page.maintenanceResources.push(resource);
        linked.push({ item: resource, created: true });
      }
    }
    return linked;
  }

  function readRequestBuffer(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  function parseContentDisposition(header = '') {
    const result = {};
    for (const part of header.split(';')) {
      const [rawKey, ...rawValue] = part.trim().split('=');
      if (!rawValue.length) continue;
      const key = rawKey.toLowerCase();
      const value = rawValue.join('=').trim().replace(/^"|"$/g, '');
      result[key] = value;
    }
    return result;
  }

  function contentDispositionFilename(disposition) {
    const encodedFilename = disposition['filename*'];
    if (encodedFilename) {
      const match = encodedFilename.match(/^(?:([^']*)'[^']*')?(.*)$/);
      const encodedValue = match?.[2] || encodedFilename;
      return normalizeImportedFilename(encodedValue);
    }

    return normalizeImportedFilename(disposition.filename);
  }

  function splitMultipartBuffer(buffer, boundary) {
    const boundaryBuffer = Buffer.from(`--${boundary}`);
    const parts = [];
    let cursor = buffer.indexOf(boundaryBuffer);

    while (cursor !== -1) {
      cursor += boundaryBuffer.length;
      if (buffer[cursor] === 45 && buffer[cursor + 1] === 45) break;
      if (buffer[cursor] === 13 && buffer[cursor + 1] === 10) cursor += 2;

      const nextBoundary = buffer.indexOf(boundaryBuffer, cursor);
      if (nextBoundary === -1) break;

      let end = nextBoundary;
      if (buffer[end - 2] === 13 && buffer[end - 1] === 10) end -= 2;
      parts.push(buffer.slice(cursor, end));
      cursor = nextBoundary;
    }

    return parts;
  }

  async function parseMultipartRequest(req) {
    const contentType = req.headers['content-type'] || '';
    const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[1]
      || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[2];
    if (!boundary) throw new Error('Missing upload boundary.');

    const body = await readRequestBuffer(req);
    const fields = {};
    const files = [];

    for (const part of splitMultipartBuffer(body, boundary)) {
      const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
      if (headerEnd === -1) continue;

      const rawHeaders = part.slice(0, headerEnd).toString('latin1').split('\r\n');
      const content = part.slice(headerEnd + 4);
      const headers = new Map(rawHeaders.map((line) => {
        const index = line.indexOf(':');
        return index === -1
          ? [line.toLowerCase(), '']
          : [line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim()];
      }));
      const disposition = parseContentDisposition(headers.get('content-disposition'));
      if (!disposition.name) continue;

      if (disposition.filename !== undefined || disposition['filename*'] !== undefined) {
        const originalName = normalizeImportedFilename(path.basename(contentDispositionFilename(disposition)));
        files.push({
          fieldName: disposition.name,
          originalName,
          mimeType: headers.get('content-type') || 'application/octet-stream',
          buffer: content,
          size: content.length
        });
      } else {
        fields[disposition.name] = content.toString('utf8');
      }
    }

    return { fields, files };
  }

  return {
    cleanupDuplicateImportedItems,
    detectImportedFileType,
    idPageSuffix,
    importFileToPage,
    linkOriginalFilesToPage,
    normalizeImportedFilename,
    parseMultipartRequest,
    repairImportedImageDisplaySizes
  };
}

module.exports = { createImportService };
