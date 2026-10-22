const path = require('path');
const { normalizeResourceLocation } = require('../public/resourceLocations');

const MIME_BY_EXTENSION = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.csv': 'text/csv'
});

function linkedResourceById(page, resourceId) {
  return [...(page?.objects || []), ...(page?.maintenanceResources || [])]
    .find((resource) => resource.id === resourceId) || null;
}

function mimeTypeForResource(resource, absolutePath = '') {
  if (typeof resource?.mimeType === 'string' && resource.mimeType.trim()) {
    return resource.mimeType.trim();
  }
  const extension = path.extname(resource?.originalName || absolutePath).toLowerCase();
  return MIME_BY_EXTENSION[extension] || 'application/octet-stream';
}

function resourceContentEtag(stat) {
  return `W/"${Number(stat.size).toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
}

function resourceContentHeaders(content) {
  return {
    'Cache-Control': 'no-cache',
    ETag: content.etag,
    'Last-Modified': content.lastModified,
    'Content-Type': content.mimeType
  };
}

function resourceContentIsFresh(headers, content) {
  const ifNoneMatch = headers?.['if-none-match'];
  if (ifNoneMatch) return ifNoneMatch === content.etag;
  const ifModifiedSince = Date.parse(headers?.['if-modified-since'] || '');
  return Number.isFinite(ifModifiedSince)
    && ifModifiedSince >= Date.parse(content.lastModified);
}

function desktopMutationAuthorized(configuredToken, providedToken) {
  return typeof configuredToken === 'string'
    && configuredToken.length >= 16
    && providedToken === configuredToken;
}

function createLinkedResourceService({ resolveLocation, fsImpl }) {
  async function prepareContent(page, resourceId) {
    const resource = linkedResourceById(page, resourceId);
    if (!resource) {
      const error = new Error('Resource not found.');
      error.code = 'RESOURCE_NOT_FOUND';
      throw error;
    }
    const location = normalizeResourceLocation(resource);
    const resolved = await resolveLocation(location, {
      pageId: page?.id,
      resourceId,
      resource
    });
    const stat = await fsImpl.stat(resolved.absolutePath);
    if (!stat.isFile()) {
      const error = new Error('Resource is not a file.');
      error.code = 'NOT_A_FILE';
      throw error;
    }
    return {
      absolutePath: resolved.absolutePath,
      resource,
      location,
      mimeType: mimeTypeForResource(resource, resolved.absolutePath),
      etag: resourceContentEtag(stat),
      lastModified: stat.mtime.toUTCString(),
      size: stat.size
    };
  }

  return { prepareContent };
}

module.exports = {
  createLinkedResourceService,
  desktopMutationAuthorized,
  linkedResourceById,
  mimeTypeForResource,
  resourceContentHeaders,
  resourceContentIsFresh,
  resourceContentEtag
};
