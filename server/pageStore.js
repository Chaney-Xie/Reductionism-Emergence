const fs = require('fs/promises');
const path = require('path');
const { readJson, readJsonIfExists } = require('./jsonStore');

function createPageStore({ dataDir, pagesDir }) {
  const DATA_DIR = dataDir;
  const PAGES_DIR = pagesDir;

  function pageDateStamp(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }
  
  function safePageFilePath(entry) {
    if (!entry || typeof entry.path !== 'string') return null;
  
    const filePath = path.resolve(DATA_DIR, entry.path);
    if (!filePath.startsWith(`${PAGES_DIR}${path.sep}`)) return null;
    return filePath;
  }
  
  function safePageFilePathFromId(pageId) {
    if (!/^[a-z0-9_-]+$/i.test(pageId)) return null;
    const filePath = path.resolve(PAGES_DIR, `${pageId}.json`);
    if (!filePath.startsWith(`${PAGES_DIR}${path.sep}`)) return null;
    return filePath;
  }
  
  function relativeDataPath(filePath) {
    return path.relative(DATA_DIR, filePath).split(path.sep).join('/');
  }
  
  async function findPageJsonPath(pageId, pageIndex = null) {
    const warnings = [];
    const entries = (pageIndex?.pages || []).filter((entry) => entry.id === pageId);
    const matchingPaths = [];
  
    for (const entry of entries) {
      const indexedPath = safePageFilePath(entry);
      if (!indexedPath) {
        warnings.push(`Page index entry for ${pageId} has an invalid path.`);
        continue;
      }
  
      const indexedPage = await readJsonIfExists(indexedPath);
      if (!indexedPage) {
        warnings.push(`Page index path does not exist: ${relativeDataPath(indexedPath)}`);
        continue;
      }
      if (indexedPage.id === pageId) {
        matchingPaths.push(indexedPath);
      } else {
        warnings.push(`Page index path ${relativeDataPath(indexedPath)} contains id ${indexedPage.id || '(missing)'}.`);
      }
    }
  
    const directPath = safePageFilePathFromId(pageId);
    if (directPath && !matchingPaths.includes(directPath)) {
      const directPage = await readJsonIfExists(directPath);
      if (directPage?.id === pageId) matchingPaths.push(directPath);
    }
  
    const files = await fs.readdir(PAGES_DIR).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(PAGES_DIR, file);
      if (matchingPaths.includes(filePath)) continue;
  
      let page;
      try {
        page = await readJson(filePath);
      } catch (error) {
        warnings.push(`Could not read ${relativeDataPath(filePath)}: ${error.message}`);
        continue;
      }
      if (page?.id === pageId) matchingPaths.push(filePath);
    }
  
    if (matchingPaths.length > 1) {
      warnings.push(`Multiple page JSON files contain id ${pageId}; using ${relativeDataPath(matchingPaths[0])}.`);
    }
  
    return {
      filePath: matchingPaths[0] || null,
      warnings
    };
  }
  
  async function auditOrphanPageFiles(pageIndex = null) {
    if (!pageIndex) throw new Error('pageIndex is required for orphan audit.');
    const index = pageIndex;
    const indexedPageIds = new Set((index.pages || []).map((page) => page.id));
    const orphans = [];
    const unreadable = [];
    const files = await fs.readdir(PAGES_DIR).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
  
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(PAGES_DIR, file);
      try {
        const page = await readJson(filePath);
        const pageId = page?.id || null;
        if (!pageId || !indexedPageIds.has(pageId)) {
          orphans.push({
            pageId,
            fileName: file,
            path: relativeDataPath(filePath)
          });
        }
      } catch (error) {
        unreadable.push({
          fileName: file,
          path: relativeDataPath(filePath),
          error: error.message
        });
      }
    }
  
    return { orphans, unreadable };
  }

  return {
    auditOrphanPageFiles,
    findPageJsonPath,
    pageDateStamp,
    relativeDataPath,
    safePageFilePath,
    safePageFilePathFromId
  };
}

module.exports = { createPageStore };
