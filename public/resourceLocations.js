(function exposeResourceLocations(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.resourceLocationsModel = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const LOCATION_TYPES = Object.freeze({ VAULT: 'vault', WORKSPACE: 'workspace', FOLDER: 'folder' });

  function normalizeRelativePath(value, { vaultOnly = false } = {}) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('A resource relative path is required.');
    }
    if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('The resource path is invalid.');
    const portable = value.trim().replace(/\\/g, '/');
    if (portable.startsWith('/') || /^[a-z]:\//i.test(portable)) {
      throw new Error('Absolute resource paths are not allowed.');
    }
    const rawSegments = portable.split('/');
    if (rawSegments.includes('..')) throw new Error('The resource path contains traversal.');
    const relativePath = rawSegments.filter((segment) => segment && segment !== '.').join('/');
    if (!relativePath) throw new Error('A resource relative path is required.');
    if (vaultOnly && !(relativePath.startsWith('assets/images/')
      || relativePath.startsWith('assets/resources/'))) {
      throw new Error('Only Viewer image and resource paths are valid vault resources.');
    }
    return relativePath;
  }

  function rawResourceLocation(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.type === LOCATION_TYPES.VAULT
      || value.type === LOCATION_TYPES.WORKSPACE
      || value.type === LOCATION_TYPES.FOLDER) {
      return value;
    }
    if (value.location && typeof value.location === 'object') return value.location;
    if (typeof value.src === 'string' && value.src.trim()) {
      return { type: LOCATION_TYPES.VAULT, relativePath: value.src };
    }
    return null;
  }

  function normalizeResourceLocation(value) {
    if (typeof value === 'string') {
      return { type: LOCATION_TYPES.VAULT, relativePath: normalizeRelativePath(value, { vaultOnly: true }) };
    }
    const raw = rawResourceLocation(value);
    if (!raw) throw new Error('This resource has no file location.');
    if (raw.type === LOCATION_TYPES.VAULT) {
      const relativePath = raw.relativePath || raw.src;
      return {
        type: LOCATION_TYPES.VAULT,
        relativePath: normalizeRelativePath(relativePath, { vaultOnly: true })
      };
    }
    if (raw.type === LOCATION_TYPES.WORKSPACE) {
      if (typeof raw.workspaceId !== 'string' || !/^[a-z0-9_-]+$/i.test(raw.workspaceId)) {
        throw new Error('A valid workspace ID is required.');
      }
      return {
        type: LOCATION_TYPES.WORKSPACE,
        workspaceId: raw.workspaceId,
        relativePath: normalizeRelativePath(raw.relativePath)
      };
    }
    if (raw.type === LOCATION_TYPES.FOLDER) {
      if (typeof raw.folderId !== 'string' || !/^folder_[a-z0-9_-]+$/i.test(raw.folderId)) {
        throw new Error('A valid folder ID is required.');
      }
      return {
        type: LOCATION_TYPES.FOLDER,
        folderId: raw.folderId,
        relativePath: normalizeRelativePath(raw.relativePath)
      };
    }
    throw new Error('Unknown resource location type.');
  }

  function tryNormalizeResourceLocation(value) {
    try {
      return normalizeResourceLocation(value);
    } catch {
      return null;
    }
  }

  function vaultResourceLocation(relativePath) {
    return normalizeResourceLocation({ type: LOCATION_TYPES.VAULT, relativePath });
  }

  function withResourceLocation(resource, nextLocation) {
    if (!resource || typeof resource !== 'object') throw new TypeError('A resource is required.');
    const location = normalizeResourceLocation(nextLocation);
    const updated = { ...resource, location };
    if (location.type === LOCATION_TYPES.VAULT) updated.src = location.relativePath;
    else delete updated.src;
    return updated;
  }

  function applyManagedResourceRelocation(page, relocation) {
    if (!page || !relocation?.location) return [];
    const updatedIds = new Set(relocation.updatedResourceIds || []);
    const previousLocation = tryNormalizeResourceLocation(relocation.previousLocation);
    const changedIds = [];
    for (const resource of [
      ...(page.objects || []),
      ...(page.maintenanceResources || [])
    ]) {
      const currentLocation = tryNormalizeResourceLocation(resource);
      const matchesPrevious = Boolean(previousLocation && currentLocation
        && JSON.stringify(previousLocation) === JSON.stringify(currentLocation));
      if (!updatedIds.has(resource.id) && !matchesPrevious) continue;
      Object.assign(resource, withResourceLocation(resource, relocation.location));
      changedIds.push(resource.id);
    }
    return changedIds;
  }

  function desktopResourceActionAvailable(resource, bridge) {
    return bridge?.isDesktop === true
      && typeof bridge.openVaultResource === 'function'
      && typeof bridge.revealVaultResource === 'function'
      && Boolean(tryNormalizeResourceLocation(resource));
  }

  function desktopAddFileAvailable(bridge) {
    return bridge?.isDesktop === true && typeof bridge.addFiles === 'function';
  }

  function desktopFileDropAvailable(bridge) {
    return bridge?.isDesktop === true && typeof bridge.addDroppedFiles === 'function';
  }

  function resourceDropMode(bridge) {
    return desktopFileDropAvailable(bridge) ? 'link' : 'copy';
  }

  function createDesktopResourceClient({ getBridge, getPageId = () => null }) {
    function canUse(resource) {
      return desktopResourceActionAvailable(resource, getBridge());
    }

    async function run(method, resource) {
      const bridge = getBridge();
      if (!desktopResourceActionAvailable(resource, bridge)) {
        return { ok: false, error: 'Desktop resource actions are unavailable.' };
      }
      return bridge[method]({
        pageId: getPageId(),
        resourceId: resource?.id || null,
        location: normalizeResourceLocation(resource)
      });
    }

    return {
      canUse,
      open: (resource) => run('openVaultResource', resource),
      reveal: (resource) => run('revealVaultResource', resource)
    };
  }

  function createRevealIconClickHandler(resource, reveal) {
    return (event) => {
      event.preventDefault();
      event.stopPropagation();
      return reveal(resource);
    };
  }

  function createResourceRowOpenClickHandler(resource, open) {
    return () => open(resource);
  }

  return {
    LOCATION_TYPES,
    applyManagedResourceRelocation,
    createDesktopResourceClient,
    createResourceRowOpenClickHandler,
    createRevealIconClickHandler,
    desktopFileDropAvailable,
    desktopResourceActionAvailable,
    desktopAddFileAvailable,
    normalizeRelativePath,
    normalizeResourceLocation,
    resourceDropMode,
    tryNormalizeResourceLocation,
    vaultResourceLocation,
    withResourceLocation
  };
}));
