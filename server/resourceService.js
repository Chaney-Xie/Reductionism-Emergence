const path = require('path');
const { tryNormalizeResourceLocation } = require('../public/resourceLocations');

function unlinkPageObject(page, itemId) {
  const objectIndex = (page.objects || []).findIndex((object) => object.id === itemId);
  if (objectIndex < 0) return null;

  const unlinkedItem = page.objects[objectIndex];
  page.objects.splice(objectIndex, 1);
  const beforeBlocks = (page.blocks || []).length;
  page.blocks = (page.blocks || []).filter((block) => block.objectId !== unlinkedItem.id);
  const removedBlockCount = beforeBlocks - page.blocks.length;
  if (removedBlockCount) {
    const remainingBlockIds = new Set(page.blocks.map((block) => block.id));
    page.highlightGroups = (page.highlightGroups || [])
      .map((group) => ({
        ...group,
        blockIds: (group.blockIds || group.blocks || [])
          .map((item) => typeof item === 'string' ? item : item?.id)
          .filter((blockId) => remainingBlockIds.has(blockId))
      }))
      .filter((group) => group.blockIds.length > 0);
  }

  return {
    unlinkedItem,
    unlinkedKind: 'object',
    removedBlockCount
  };
}

function unlinkPageMaintenanceResource(page, itemId) {
  const resourceIndex = (page.maintenanceResources || [])
    .findIndex((resource) => resource.id === itemId);
  if (resourceIndex < 0) return null;

  const [unlinkedItem] = page.maintenanceResources.splice(resourceIndex, 1);
  return {
    unlinkedItem,
    unlinkedKind: 'resource',
    removedBlockCount: 0
  };
}

function unlinkPageResource(page, itemId) {
  return unlinkPageObject(page, itemId) || unlinkPageMaintenanceResource(page, itemId);
}

function unlinkAllPageResources(page) {
  const objectUnlinks = (page.objects || [])
    .map((object) => object.id)
    .map((objectId) => unlinkPageObject(page, objectId))
    .filter(Boolean);
  const maintenanceUnlinks = (page.maintenanceResources || [])
    .map((resource) => resource.id)
    .map((resourceId) => unlinkPageMaintenanceResource(page, resourceId))
    .filter(Boolean);

  return {
    objectUnlinks,
    maintenanceUnlinks,
    removedBlockCount: objectUnlinks.reduce(
      (count, unlink) => count + unlink.removedBlockCount,
      0
    )
  };
}

// Safe local-asset lookup and the physical phase owned by explicit Page destruction.
function createResourceService({
  root,
  safePageFilePath,
  readJson,
  deletePageOwnedFile
}) {
  const ROOT = root;
  function vaultAssetSrc(resourceOrSrc) {
    const location = tryNormalizeResourceLocation(resourceOrSrc);
    return location?.type === 'vault' ? location.relativePath : null;
  }
  function localAssetFilePath(src) {
    if (typeof src !== 'string' || !src.startsWith('assets/')) return null;
    if (/^[a-z]+:/i.test(src) || src.startsWith('//')) return null;

    const assetsDir = path.join(ROOT, 'assets');
    const filePath = path.resolve(ROOT, src);
    if (!filePath.startsWith(`${assetsDir}${path.sep}`)) return null;
    return filePath;
  }

  async function assetSrcUsedElsewhere(src, pageIndex, deletedPageId) {
    for (const entry of pageIndex.pages || []) {
      if (entry.id === deletedPageId) continue;

      const filePath = safePageFilePath(entry);
      if (!filePath) continue;

      try {
        const page = await readJson(filePath);
        if ((page.objects || []).some((object) => vaultAssetSrc(object) === src)) return true;
        if ((page.maintenanceResources || [])
          .some((resource) => vaultAssetSrc(resource) === src)) return true;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }

    return false;
  }

  async function deletePageDestructionObjectFiles(objectUnlinks, pageIndex, deletedPageId) {
    const deletedAssets = [];
    const objectSrcs = [...new Set((objectUnlinks || [])
      .map((unlink) => vaultAssetSrc(unlink?.unlinkedItem))
      .filter(Boolean))];

    for (const src of objectSrcs) {
      const filePath = localAssetFilePath(src);
      if (!filePath) continue;
      if (await assetSrcUsedElsewhere(src, pageIndex, deletedPageId)) continue;

      await deletePageOwnedFile(filePath);
      deletedAssets.push(src);
    }

    return deletedAssets;
  }

  return {
    deletePageDestructionObjectFiles,
    localAssetFilePath
  };
}

module.exports = {
  createResourceService,
  unlinkAllPageResources,
  unlinkPageMaintenanceResource,
  unlinkPageObject,
  unlinkPageResource
};
